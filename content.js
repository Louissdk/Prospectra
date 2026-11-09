(() => {
  if (window.__prospectraContentLoaded) return;
  window.__prospectraContentLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let activeCaptureTaskId = null;

  function reportProgress(payload) {
    if (!activeCaptureTaskId) return;
    chrome.runtime.sendMessage({
      ...payload,
      type: 'PROSPECTRA_PROGRESS',
      taskId: activeCaptureTaskId
    }).catch(() => {});
  }
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = (value) => {
    try { return new URL(value, location.href).href; } catch { return ''; };
  };
  const validMapsTab = () => /(^|\.)google\.[^/]+$/.test(location.hostname) && /\/maps/.test(location.pathname);

  function getFeed() {
    return document.querySelector('[role="feed"]') ||
      document.querySelector('div[aria-label*="Results for"], div[aria-label*="Resultados para"]');
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
    if (tel) return formatPhone(decodeURIComponent(tel.replace(/^tel:/i, '')));
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

  async function waitForDetail(previousUrl, expectedName, timeout = 6500) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const heading = detailRoot().querySelector('h1');
      const headingText = clean(heading?.textContent || '').toLowerCase();
      const expected = clean(expectedName).toLowerCase();
      const hasDetail = headingText.length > 1 && expected.length > 1 && (headingText === expected || headingText.includes(expected));
      const urlChanged = location.href !== previousUrl && /\/maps\/place\//.test(location.pathname);
      if (hasDetail || urlChanged) {
        await sleep(500);
        return true;
      }
      await sleep(200);
    }
    return false;
  }

  async function returnToResults(previousUrl) {
    const backButton = [...document.querySelectorAll('button')].find((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
      return /back|voltar|return|resultados/i.test(label);
    });
    if (backButton) backButton.click();
    else if (location.href !== previousUrl) {
      try { history.back(); } catch {}
    }
    for (let i = 0; i < 45; i += 1) {
      await sleep(200);
      if (getFeed()) return true;
    }
    return !!getFeed();
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
    let feed = getFeed();
    if (!feed) throw new Error('Não encontrei a lista de resultados. Aguarde o Google Maps terminar a pesquisa.');

    const parsedLimit = Number(limit);
    const unlimited = Number.isFinite(parsedLimit) && parsedLimit === 0;
    const maxLeads = unlimited ? Infinity : Math.max(1, Math.min(
      Number.isFinite(parsedLimit) ? Math.floor(parsedLimit) : 40,
      5000
    ));
    const threshold = Math.max(0, Math.min(Number(minRating) || 0, 5));
    const collected = [];
    const processed = new Set();
    let filteredOut = 0;
    let stagnantRounds = 0;
    let scrollRounds = 0;

    // Processa cada lote visível e avança a lista para forçar o carregamento progressivo do Maps.
    while ((unlimited || collected.length < maxLeads) && scrollRounds < (unlimited ? 2000 : 140) && stagnantRounds < 4) {
      feed = getFeed();
      if (!feed) break;
      const cards = collectCards();
      let newInRound = 0;

      for (const basic of cards) {
        if (collected.length >= maxLeads) break;
        const key = basic.mapsUrl || `${basic.name}|${basic.address}`;
        if (processed.has(key)) continue;
        processed.add(key);
        newInRound += 1;

        const rating = Number(String(basic.rating || '').replace(',', '.'));
        if (threshold > 0 && (!basic.rating || !Number.isFinite(rating) || rating < threshold)) {
          filteredOut += 1;
          reportProgress({ done: collected.length + filteredOut, total: maxLeads, name: `Descartado por nota: ${basic.name}` });
          continue;
        }

        reportProgress({ done: collected.length + filteredOut, total: maxLeads, name: basic.name });
        let details = { ...basic, ...context, website: '', whatsappUrl: '', emails: [], emailStatus: 'pending' };
        const anchor = [...(getFeed()?.querySelectorAll('a[href*="/maps/place/"]') || [])]
          .find((node) => absolute(node.href) === basic.mapsUrl);
        if (anchor) {
          const previousUrl = location.href;
          let opened = false;
          try {
            anchor.scrollIntoView({ block: 'center', behavior: 'auto' });
            await sleep(180);
            anchor.click();
            opened = await waitForDetail(previousUrl, basic.name);
            if (opened) details = extractDetail(basic, context);
            else details.captureNote = 'A ficha não abriu a tempo; dados do cartão foram preservados.';
          } catch (error) {
            details.captureNote = error?.message || 'Não foi possível abrir a ficha da empresa.';
          }
          if (opened || getFeed() === null || location.href !== previousUrl) await returnToResults(previousUrl);
        } else {
          details.captureNote = 'O cartão saiu da lista antes da abertura da ficha.';
        }
        collected.push(details);
      }

      if (collected.length >= maxLeads) break;
      feed = getFeed();
      if (!feed) break;
      if (newInRound === 0) stagnantRounds += 1;
      else stagnantRounds = 0;

      const beforeTop = feed.scrollTop;
      const beforeHeight = feed.scrollHeight;
      const step = Math.max(500, Math.floor(feed.clientHeight * 0.82));
      feed.scrollTop = Math.min(Math.max(0, feed.scrollHeight - feed.clientHeight), beforeTop + step);
      scrollRounds += 1;
      await sleep(1100);
      const afterFeed = getFeed();
      if (!afterFeed) break;
      const afterCards = collectCards();
      const unseenCards = afterCards.filter((item) => !processed.has(item.mapsUrl || `${item.name}|${item.address}`)).length;
      const contentGrew = afterFeed.scrollHeight > beforeHeight;
      const moved = afterFeed.scrollTop !== beforeTop;
      if (unseenCards > 0 || contentGrew || moved) stagnantRounds = 0;
      else stagnantRounds += 1;
    }

    reportProgress({ done: collected.length + filteredOut, total: Number.isFinite(maxLeads) ? maxLeads : 0, name: 'Coleta concluída' });
    return { items: collected, filteredOut, scanned: processed.size, requested: unlimited ? 0 : maxLeads };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PROSPECTRA_CAPTURE_START') {
      if (activeCaptureTaskId) {
        sendResponse({ ok: false, error: 'Já existe uma coleta em andamento nesta aba.' });
        return false;
      }

      const taskId = String(message.taskId || crypto.randomUUID());
      activeCaptureTaskId = taskId;
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
        for (let offset = 0; offset < items.length; offset += 20) {
          await chrome.runtime.sendMessage({
            type: 'PROSPECTRA_CAPTURE_BATCH',
            taskId,
            items: items.slice(offset, offset + 20)
          });
        }
        const { items: _items, ...summary } = result;
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
      });

      return false;
    }

    if (message?.type === 'PROSPECTRA_PING') {
      sendResponse({ ok: true, isMaps: validMapsTab() });
      return false;
    }
    return false;
  });
})();
