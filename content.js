(() => {
  if (window.__prospectraContentLoaded) return;
  window.__prospectraContentLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let activeCaptureTaskId = null;
  let activeCaptureCancelled = false;
  let captureHeartbeatTimer = null;

  function startCaptureHeartbeat(taskId) {
    clearInterval(captureHeartbeatTimer);
    captureHeartbeatTimer = setInterval(() => {
      if (activeCaptureTaskId !== taskId) return;
      chrome.runtime.sendMessage({ type: 'PROSPECTRA_HEARTBEAT', taskId, at: Date.now() }).catch(() => {});
    }, 8000);
  }

  function reportProgress(payload) {
    if (!activeCaptureTaskId) return;
    chrome.runtime.sendMessage({
      ...payload,
      type: 'PROSPECTRA_PROGRESS',
      taskId: activeCaptureTaskId
    }).catch(() => {});
  }

  async function sendRuntimeMessage(message, timeoutMs = 12000) {
    let timeoutId = null;
    try {
      return await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Tempo excedido ao comunicar com o armazenamento da extensão.')), timeoutMs);
        })
      ]);
    } finally { clearTimeout(timeoutId); }
  }
  async function sendCaptureBatch(items) {
    if (!activeCaptureTaskId || !items?.length) return true;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await sendRuntimeMessage({
          type: 'PROSPECTRA_CAPTURE_BATCH', taskId: activeCaptureTaskId, items
        });
        if (response?.ok) return true;
        throw new Error(response?.error || 'O armazenamento não confirmou o lote.');
      } catch (error) {
        lastError = error;
        console.warn('[Prospectra] Falha ao salvar lote (tentativa ' + attempt + '/3):', error);
        if (attempt < 3) await sleep(500 * attempt);
      }
    }
    throw new Error('Não foi possível confirmar o salvamento do lote: ' + (lastError?.message || 'falha de comunicação'));
  }

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = (value) => {
    try { return new URL(value, location.href).href; } catch { return ''; };
  };
  const validMapsTab = () => /(^|\.)google\.[^/]+$/.test(location.hostname) && /\/maps/.test(location.pathname);

  function isRendered(element) {
    if (!element?.isConnected || !element.getClientRects?.().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
  function getFeed() {
    const candidates = [...document.querySelectorAll(
      '[role="feed"], div[aria-label*="Results for"], div[aria-label*="Resultados para"]'
    )];
    const visible = candidates.filter(isRendered);
    return visible.find((element) => element.querySelector('a[href*="/maps/place/"]')) ||
      visible.sort((a,b) => (b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0] || null;
  }

  function getCard(anchor) {
    if (!anchor) return null;
    const direct = anchor.closest('[role="article"], .Nv2PK');
    if (direct) return direct;
    let node = anchor;
    for (let depth = 0; depth < 8 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      const text = clean(node.innerText);
      if (text.length > 25 && text.length < 1300 &&
          (node.querySelector('[aria-label*="star"], [aria-label*="estrela"]') || /\b[0-5][,.]\d\b/.test(text))) return node;
    }
    return anchor.parentElement?.parentElement || anchor;
  }

  function textOf(el) {
    return clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '');
  }

  function parseRating(card) {
    const ratingNode = card?.querySelector('[aria-label*="star"], [aria-label*="estrela"], [aria-label*="Star"], [aria-label*="Estrela"]');
    const ratingSource = `${ratingNode?.getAttribute('aria-label') || ''} ${card?.innerText || ''}`;
    const explicit = ratingSource.match(/\b([0-5](?:[,.]\d)?)\s*(?:stars?|estrelas?)\b/i);
    const decimal = ratingSource.match(/\b([0-5][,.]\d)\b/);
    const match = explicit || decimal;
    return match ? match[1].replace(',', '.') : '';
  }

  function parseReviewCount(text) {
    const match = String(text || '').match(/\(?\s*([\d.\s,]+)\s*\)?\s*(?:reviews?|avaliações?|avalia[cç][õo]es?)/i);
    return match ? match[1].replace(/[.\s,]/g, '') : '';
  }

  function formatPhone(raw) {
    const value = clean(raw).replace(/^(?:telefone|phone|ligar|call)\s*:?\s*/i, '');
    let digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      const local = digits.slice(2);
      return `+55 (${local.slice(0, 2)}) ${local.length === 11 ? local.slice(2, 7) : local.slice(2, 6)}-${local.length === 11 ? local.slice(7) : local.slice(6)}`;
    }
    if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  function phoneFromCard(card) {
    const tel = card?.querySelector('a[href^="tel:"]')?.getAttribute('href');
    if (tel) {
      const raw = tel.replace(/^tel:/i, '');
      try { return formatPhone(decodeURIComponent(raw)); }
      catch { return formatPhone(raw); }
    }
    const dataItem = card?.querySelector('[data-item-id^="phone:tel:"]')?.getAttribute('data-item-id');
    if (dataItem) return formatPhone(dataItem.replace(/^phone:tel:/i, ''));
    const labelled = card?.querySelector('[aria-label*="Telefone"], [aria-label*="Phone"]')?.getAttribute('aria-label');
    if (labelled) return formatPhone(labelled);
    const text = card?.innerText || '';
    const match = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
    return match ? formatPhone(match[0]) : '';
  }

  function extractCard(anchor) {
    const card = getCard(anchor);
    const titleEl = card?.querySelector('.qBF1Pd, [class*="fontHeadlineSmall"], [class*="NrDZNb"], h3');
    const ariaName = clean(anchor.getAttribute('aria-label'));
    const name = textOf(titleEl) || ariaName.replace(/\s+\d+(?:[,.]\d+)?\s*stars?.*$/i, '') || textOf(anchor);
    const cardText = clean(card?.innerText || anchor.innerText);
    const categorySource = [...(card?.querySelectorAll('[class*="W4Efsd"], [class*="fontBodyMedium"]') || [])]
      .map((node) => clean(node.innerText)).find((value) => value && value.length < 100);
    const lines = (card?.innerText || '').split('\n').map(clean).filter(Boolean);
    const address = lines.find((line) => line !== name && line.length > 10 && /\d/.test(line) && /[,\-]/.test(line) && !/(star|estrela|review|avalia|\+?\d[\d ().-]{7,})/i.test(line)) || '';
    return {
      name: name || 'Empresa sem nome identificado',
      category: clean(categorySource?.split('·')?.[0] || ''),
      phone: phoneFromCard(card),
      address,
      rating: parseRating(card),
      reviewCount: parseReviewCount(cardText),
      mapsUrl: absolute(anchor.href),
      source: 'Google Maps'
    };
  }

  function collectCards() {
    const feed = getFeed();
    if (!feed) return [];
    const anchors = [...feed.querySelectorAll('a[href*="/maps/place/"]')];
    const results = [];
    const seen = new Set();
    for (const anchor of anchors) {
      const url = absolute(anchor.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const item = extractCard(anchor);
      if (item.name !== 'Empresa sem nome identificado' || item.phone || item.address) results.push(item);
    }
    return results;
  }

  function detailRoot() {
    return document.querySelector('[role="main"]') || document;
  }

  function normalizeWebsite(rawWebsite) {
    try {
      const url = new URL(rawWebsite, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      if (/(^|\.)google\./i.test(url.hostname) || /(^|\.)wa\.me$/i.test(url.hostname) || /whatsapp\.com$/i.test(url.hostname)) return '';
      if (/goo\.gl|googleadservices/i.test(url.href)) return '';
      return url.href;
    } catch { return ''; }
  }

  function extractWhatsApp(root) {
    const link = [...root.querySelectorAll('a[href]')].find((anchor) => /(?:wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send)/i.test(anchor.href));
    if (!link) return '';
    try {
      const url = new URL(link.href);
      if (url.hostname.endsWith('wa.me')) return `https://wa.me/${url.pathname.replace(/^\/+/, '')}`;
      const phone = url.searchParams.get('phone');
      if (phone) return `https://wa.me/${phone.replace(/\D/g, '')}`;
    } catch {}
    return '';
  }

  function extractDetail(card = {}, context = {}) {
    const root = detailRoot();
    const heading = root.querySelector('h1');
    const name = textOf(heading) || card.name;
    const websiteLink = root.querySelector('a[data-item-id="authority"], a[aria-label*="Website"], a[aria-label*="website"], a[aria-label*="Site"], a[aria-label*="site"]');
    let website = normalizeWebsite(websiteLink?.href || '');
    if (!website) {
      const external = [...root.querySelectorAll('a[href^="http"]')].find((anchor) => normalizeWebsite(anchor.href));
      if (external) website = normalizeWebsite(external.href);
    }
    const addressEl = root.querySelector('button[data-item-id="address"], button[aria-label*="Address"], button[aria-label*="Endereço"], [data-item-id="address"]');
    const phoneEl = root.querySelector('button[data-item-id^="phone:tel:"], button[aria-label*="Phone"], button[aria-label*="Telefone"], [data-item-id^="phone:tel:"], a[href^="tel:"]');
    const dataPhone = phoneEl?.getAttribute('data-item-id')?.replace(/^phone:tel:/i, '');
    const hrefPhone = phoneEl?.getAttribute('href')?.replace(/^tel:/i, '');
    const ariaPhone = phoneEl?.getAttribute('aria-label') || '';
    const phone = formatPhone(dataPhone || hrefPhone || ariaPhone || textOf(phoneEl)) || card.phone || '';
    const categoryEl = root.querySelector('button[jsaction*="category"], [class*="DkEaL"]');
    const emailLinks = [...root.querySelectorAll('a[href^="mailto:"]')].map((anchor) => anchor.href.replace(/^mailto:/i, '').split('?')[0]).filter(Boolean);
    return {
      ...card,
      ...context,
      name: name || card.name,
      website,
      whatsappUrl: extractWhatsApp(root) || card.whatsappUrl || '',
      address: textOf(addressEl) || card.address || '',
      phone,
      category: textOf(categoryEl) || card.category || '',
      emails: [...new Set(emailLinks.map((item) => item.toLowerCase()))],
      emailStatus: emailLinks.length ? 'found' : (website ? 'pending' : 'no_website')
    };
  }

  function isPlaceRoute() {
    return /\/maps\/place\//i.test(location.pathname);
  }
  function throwIfCaptureCancelled() {
    if (activeCaptureCancelled) throw new Error('Coleta cancelada.');
  }
  async function waitForResults(timeout = 18000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      throwIfCaptureCancelled();
      const feed = getFeed();
      if (feed && collectCards().length) return feed;
      await sleep(300);
    }
    throw new Error('O Google Maps não disponibilizou cartões de empresas. Aguarde os resultados carregarem e tente novamente.');
  }
  async function waitForDetail(expectedName, expectedUrl = '', timeout = 6500) {
    const started = Date.now();
    const expected = clean(expectedName).toLowerCase();
    let matchingHeadingSamples = 0;
    let targetPath = '';
    try { targetPath = new URL(expectedUrl, location.href).pathname.replace(/\/$/, ''); } catch {}
    while (Date.now() - started < timeout) {
      throwIfCaptureCancelled();
      const headingText = clean(detailRoot().querySelector('h1')?.textContent || '').toLowerCase();
      const headingMatches = expected.length > 1 &&
        (headingText === expected || headingText.includes(expected) || expected.includes(headingText));
      matchingHeadingSamples = headingMatches ? matchingHeadingSamples + 1 : 0;
      let currentPath = '';
      try { currentPath = new URL(location.href).pathname.replace(/\/$/, ''); } catch {}
      if (matchingHeadingSamples >= 2 || (!!targetPath && isPlaceRoute() && currentPath === targetPath)) {
        await sleep(350);
        return true;
      }
      await sleep(180);
    }
    return false;
  }
  async function returnToResults(previousUrl, timeout = 7000) {
    const backButton = [...document.querySelectorAll('button')].filter(isRendered).find((button) => {
      const label = (button.getAttribute('aria-label') || '') + ' ' +
        (button.getAttribute('title') || '') + ' ' + (button.innerText || '');
      return /back to results|voltar para resultados|retornar aos resultados|resultados|\bback\b|\bvoltar\b|\bclose\b|\bfechar\b/i.test(label);
    });
    if (backButton) backButton.click();
    else if (isPlaceRoute() || location.href !== previousUrl) {
      try { history.back(); } catch {}
    } else return false;
    const started = Date.now();
    let fallbackUsed = false;
    while (Date.now() - started < timeout) {
      throwIfCaptureCancelled();
      if (!isPlaceRoute() && getFeed()) return true;
      if (!fallbackUsed && Date.now() - started > 2200 &&
          (isPlaceRoute() || location.href !== previousUrl)) {
        fallbackUsed = true;
        try { history.back(); } catch {}
      }
      await sleep(200);
    }
    return !isPlaceRoute() && !!getFeed();
  }

  async function captureOpenBusiness(context = {}) {
    const details = extractDetail({ mapsUrl: location.href, source: 'Google Maps' }, context);
    if (!details.name || details.name === 'Empresa sem nome identificado') {
      throw new Error('Abra a ficha de uma empresa no Google Maps antes de capturá-la.');
    }
    return { items: [details], filteredOut: 0 };
  }

  async function captureVisibleBusinesses(limit = 40, minRating = 0, context = {}) {
    if (!validMapsTab()) throw new Error('Abra uma pesquisa do Google Maps antes de iniciar a coleta.');
    await waitForResults();
    const parsedLimit = Number(limit);
    const unlimited = Number.isFinite(parsedLimit) && parsedLimit === 0;
    const maxLeads = unlimited ? Infinity : Math.max(1, Math.min(
      Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 40, 500
    ));
    const progressTotal = Number.isFinite(maxLeads) ? maxLeads : 0;
    const threshold = Math.max(0, Math.min(Number(minRating) || 0, 5));
    const collected = [];
    const processed = new Set();
    let filteredOut = 0, stagnantRounds = 0, scrollRounds = 0, sentCount = 0;
    let stopReason = '';

    while ((unlimited || collected.length < maxLeads) &&
           scrollRounds < (unlimited ? 2000 : 180) && stagnantRounds < 6) {
      throwIfCaptureCancelled();
      const feed = getFeed();
      if (!feed) { stopReason = 'A lista de resultados deixou de estar disponível.'; break; }
      const cards = collectCards();
      const basic = cards.find((item) => {
        const key = item.mapsUrl || item.name + '|' + item.address;
        return key && !processed.has(key);
      });

      if (basic) {
        const key = basic.mapsUrl || basic.name + '|' + basic.address;
        processed.add(key);
        const rating = Number(String(basic.rating || '').replace(',', '.'));
        if (threshold > 0 && (!basic.rating || !Number.isFinite(rating) || rating < threshold)) {
          filteredOut += 1;
          reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Descartado pela nota: ' + basic.name });
          continue;
        }

        let details = { ...basic, ...context, website: '', whatsappUrl: '', emails: [], emailStatus: 'pending' };
        const anchor = [...(getFeed()?.querySelectorAll('a[href*="/maps/place/"]') || [])]
          .find((node) => absolute(node.href) === basic.mapsUrl && isRendered(node));

        if (anchor) {
          const previousUrl = location.href;
          try {
            reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Abrindo ficha: ' + basic.name });
            anchor.scrollIntoView({ block: 'center', behavior: 'auto' });
            await sleep(120);
            throwIfCaptureCancelled();
            anchor.click();
            reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Aguardando ficha: ' + basic.name });
            const opened = await waitForDetail(basic.name, basic.mapsUrl);
            if (opened) {
              reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Lendo contatos: ' + basic.name });
              details = extractDetail(basic, context);
            } else {
              details.captureNote = 'A ficha não confirmou a abertura; os dados do cartão foram preservados.';
            }
            reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Retornando aos resultados após: ' + basic.name });
            const returned = await returnToResults(previousUrl);
            if (!returned) {
              details.captureNote = [details.captureNote, 'O Google Maps não confirmou o retorno à lista. A coleta foi interrompida para evitar abrir fichas sobrepostas.'].filter(Boolean).join(' ');
              collected.push(details);
              if (collected.length - sentCount >= 2) {
                await sendCaptureBatch(collected.slice(sentCount));
                sentCount = collected.length;
              }
              stopReason = 'Não foi possível retornar à lista após: ' + basic.name;
              break;
            }
          } catch (error) {
            details.captureNote = [details.captureNote, error?.message || 'Falha durante a abertura ou leitura da ficha.'].filter(Boolean).join(' ');
            if (isPlaceRoute() || location.href !== previousUrl) {
              const returned = await returnToResults(previousUrl);
              if (!returned) {
                collected.push(details);
                stopReason = 'Falha ao retornar aos resultados depois de: ' + basic.name;
                break;
              }
            }
          }
        } else {
          details.captureNote = 'O cartão não estava mais disponível na lista visível.';
        }

        collected.push(details);
        reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Lead capturado: ' + basic.name });
        if (collected.length - sentCount >= 2) {
          reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Salvando lote de leads' });
          await sendCaptureBatch(collected.slice(sentCount));
          sentCount = collected.length;
        }
        continue;
      }

      const beforeTop = feed.scrollTop;
      const beforeHeight = feed.scrollHeight;
      const step = Math.max(420, Math.floor(feed.clientHeight * 0.78));
      feed.scrollTo({
        top: Math.min(Math.max(0, feed.scrollHeight - feed.clientHeight), beforeTop + step),
        behavior: 'instant'
      });
      scrollRounds += 1;
      reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Carregando mais resultados do Google Maps' });

      const scrollStarted = Date.now();
      let foundMore = false;
      while (Date.now() - scrollStarted < 6000) {
        throwIfCaptureCancelled();
        await sleep(300);
        const currentFeed = getFeed();
        if (!currentFeed) break;
        const currentCards = collectCards();
        const hasUnseen = currentCards.some((item) => {
          const nextKey = item.mapsUrl || item.name + '|' + item.address;
          return nextKey && !processed.has(nextKey);
        });
        if (hasUnseen || currentFeed.scrollHeight > beforeHeight) { foundMore = true; break; }
      }
      const afterFeed = getFeed();
      if (!afterFeed) { stopReason = 'A lista de resultados desapareceu durante a rolagem.'; break; }
      const moved = afterFeed.scrollTop !== beforeTop;
      stagnantRounds = foundMore || moved ? 0 : stagnantRounds + 1;
    }

    if (sentCount < collected.length) {
      reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Salvando últimos leads' });
      await sendCaptureBatch(collected.slice(sentCount));
      sentCount = collected.length;
    }
    reportProgress({
      done: collected.length + filteredOut,
      total: progressTotal,
      name: stopReason || 'Coleta concluída'
    });
    return {
      items: collected, sentCount, filteredOut, scanned: processed.size,
      requested: unlimited ? 0 : maxLeads, stopReason
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PROSPECTRA_CAPTURE_START') {
      if (activeCaptureTaskId) {
        sendResponse({ ok: false, error: 'Já existe uma coleta em andamento nesta aba.' });
        return false;
      }

      const taskId = String(message.taskId || crypto.randomUUID());
      activeCaptureTaskId = taskId;
      activeCaptureCancelled = false;
      startCaptureHeartbeat(taskId);
      const context = {
        searchTerm: clean(message.searchTerm || ''),
        city: clean(message.city || '')
      };

      // Resposta imediata: não manter um canal aberto enquanto o Maps navega
      // entre fichas ou coloca o documento no back/forward cache.
      sendResponse({ ok: true, started: true, taskId });

      Promise.resolve().then(async () => {
        if (message.mode === 'open') return captureOpenBusiness(context);
        return captureVisibleBusinesses(message.limit, message.minRating, context);
      }).then(async (result) => {
        const items = Array.isArray(result.items) ? result.items : [];
        if (Number(result.sentCount || 0) < items.length) {
          for (let offset = Number(result.sentCount || 0); offset < items.length; offset += 3) {
            await sendCaptureBatch(items.slice(offset, offset + 3));
          }
        }
        const { items: _items, sentCount: _sentCount, ...summary } = result;
        await chrome.runtime.sendMessage({
          type: 'PROSPECTRA_CAPTURE_COMPLETE',
          taskId,
          ok: true,
          ...summary
        });
      }).catch(async (error) => {
        try {
          await chrome.runtime.sendMessage({
            type: 'PROSPECTRA_CAPTURE_COMPLETE',
            taskId,
            ok: false,
            error: error?.message || 'Falha na coleta.'
          });
        } catch {}
      }).finally(() => {
        if (activeCaptureTaskId === taskId) activeCaptureTaskId = null;
        activeCaptureCancelled = false;
        clearInterval(captureHeartbeatTimer);
        captureHeartbeatTimer = null;
      });

      return false;
    }

    if (message?.type === 'PROSPECTRA_CAPTURE_CANCEL' &&
        message.taskId === activeCaptureTaskId) {
      activeCaptureCancelled = true;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'PROSPECTRA_PING') {
      sendResponse({ ok: true, isMaps: validMapsTab() });
      return false;
    }
    return false;
  });
})();
