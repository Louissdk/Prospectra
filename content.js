(() => {
  if (window.__prospectraContentLoaded) return;
  window.__prospectraContentLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let activeCaptureTaskId = null;
  let activeCaptureCancelled = false;
  let activeCapturePaused = false;
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

  async function persistCaptureCheckpoint(checkpoint) {
    if (!activeCaptureTaskId) return false;
    try {
      const response = await sendRuntimeMessage({
        type: 'PROSPECTRA_SAVE_CHECKPOINT',
        taskId: activeCaptureTaskId,
        checkpoint: { ...checkpoint, taskId: activeCaptureTaskId }
      }, 7000);
      return !!response?.ok;
    } catch (error) {
      console.warn('[Prospectra] Checkpoint não confirmado:', error);
      return false;
    }
  }

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = (value) => {
    try { return new URL(value, location.href).href; } catch { return ''; };
  };
  const isGoogleDomain = (hostname = '') => /(^|\.)google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(String(hostname || '').toLowerCase().replace(/\.$/, ''));
  const validMapsTab = () => isGoogleDomain(location.hostname) && /^\/maps(?:\/|$)/i.test(location.pathname);

  function isRendered(element) {
    if (!element?.isConnected || !element.getClientRects?.().length) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
  const RESULT_FEED_SELECTORS = [
    '[role="feed"]',
    '[aria-label*="Results for" i]',
    '[aria-label*="Search results" i]',
    '[aria-label*="Resultados" i]',
    '[aria-label*="resultado" i]',
    '.m6QErb[aria-label]',
    '[role="main"] .m6QErb[aria-label]',
    '[role="main"] .m6QErb',
    '[role="main"]'
  ];

  function isMapsResultAnchor(anchor) {
    if (!anchor?.href) return false;
    try {
      const url = new URL(anchor.href, location.href);
      if (!isGoogleDomain(url.hostname)) return false;
      const path = url.pathname.toLowerCase();
      return path.includes('/maps/place/') ||
        (path.endsWith('/maps') && url.searchParams.has('cid'));
    } catch {
      return false;
    }
  }

  function getResultAnchors(root = document) {
    return [...root.querySelectorAll('a[href*="/maps"]')].filter(isMapsResultAnchor);
  }

  function getResultDiagnostics() {
    const candidates = new Set();
    for (const selector of RESULT_FEED_SELECTORS) {
      try { document.querySelectorAll(selector).forEach((element) => candidates.add(element)); } catch {}
    }
    const visible = [...candidates].filter(isRendered);
    return {
      containers: candidates.size,
      visibleContainers: visible.length,
      businessLinks: getResultAnchors(document).length
    };
  }

  function getFeed() {
    const candidates = new Set();
    for (const selector of RESULT_FEED_SELECTORS) {
      try { document.querySelectorAll(selector).forEach((element) => candidates.add(element)); } catch {}
    }
    const ranked = [...candidates].filter(isRendered).map((element) => {
      const links = getResultAnchors(element).length;
      const scrollable = element.scrollHeight > element.clientHeight + 80;
      const priority = element.getAttribute('role') === 'feed' ? 4 :
        element.matches('[aria-label*="Results for" i], [aria-label*="Search results" i], [aria-label*="Resultados" i], [aria-label*="resultado" i]') ? 3 :
        element.matches('.m6QErb') ? 2 : 1;
      return { element, links, scrollable, priority, scrollRoom: Math.max(0, element.scrollHeight - element.clientHeight) };
    });
    ranked.sort((a, b) =>
      (b.priority - a.priority) || (Number(b.scrollable) - Number(a.scrollable)) ||
      (b.links - a.links) || (b.scrollRoom - a.scrollRoom)
    );
    return ranked.find((item) => item.links > 0)?.element ||
      ranked.find((item) => item.scrollable)?.element ||
      ranked[0]?.element || null;
  }

  function getCard(anchor) {
    if (!anchor) return null;
    const direct = anchor.closest('[role="article"], .Nv2PK, [data-result-index], [jsaction*="mouseover:pane"]');
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
      placeId: extractPlaceIdFromUrl(anchor.href),
      phones: phoneFromCard(card) ? [phoneFromCard(card)] : [],
      sourceMap: { name: 'google_maps', category: 'google_maps', phone: 'google_maps', address: 'google_maps', rating: 'google_maps' },
      confidence: { name: name ? 'high' : 'low', category: categorySource ? 'high' : 'low', phone: phoneFromCard(card) ? 'medium' : 'unknown', address: address ? 'medium' : 'unknown' },
      source: 'Google Maps'
    };
  }

  function collectCards() {
    const feed = getFeed();
    if (!feed) return [];
    const anchors = getResultAnchors(feed);
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

  function extractPlaceIdFromUrl(rawUrl = '') {
    try {
      const url = new URL(rawUrl, location.href);
      for (const key of ['query_place_id', 'place_id', 'placeid', 'cid']) {
        const value = url.searchParams.get(key);
        if (value) return key === 'cid' ? 'cid:' + value : value;
      }
      const data = url.href.match(/!1s(ChIJ[A-Za-z0-9_-]{8,}|0x[0-9a-f]+:0x[0-9a-f]+)/i);
      if (data) return data[1];
      const path = url.pathname.match(/\/maps\/place\/([^/]+)/i);
      return path ? 'maps-path:' + decodeURIComponent(path[1]).toLowerCase() : '';
    } catch { return ''; }
  }
  function extractPhonesFromRoot(root, fallback = '') {
    const values = [];
    for (const node of root.querySelectorAll('a[href^="tel:"], [data-item-id^="phone:tel:"], button[data-item-id^="phone:tel:"]')) {
      const raw = node.getAttribute('href')?.replace(/^tel:/i, '') ||
        node.getAttribute('data-item-id')?.replace(/^phone:tel:/i, '') ||
        node.getAttribute('aria-label') || node.innerText || '';
      const digits = String(raw).replace(/\D/g, '');
      const validLength = [10, 11].includes(digits.length) || (digits.startsWith('55') && [12, 13].includes(digits.length));
      if (!validLength) continue;
      const phone = formatPhone(raw);
      if (phone) values.push(phone);
    }
    if (fallback) values.push(fallback);
    return [...new Set(values)];
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
    const phones = extractPhonesFromRoot(root, phone);
    const categoryEl = root.querySelector('button[jsaction*="category"], [class*="DkEaL"]');
    const emailLinks = [...root.querySelectorAll('a[href^="mailto:"]')].map((anchor) => anchor.href.replace(/^mailto:/i, '').split('?')[0]).filter(Boolean);
    const pageText = clean(root.innerText || '');
    const openingHours = textOf(root.querySelector('[data-item-id*="oh"], [aria-label*="Hours"], [aria-label*="Horário"], [data-item-id*="hours"]'));
    const closedStatus = /permanently closed|permanentemente fechado/i.test(pageText) ? 'permanently_closed' :
      /temporarily closed|temporariamente fechado/i.test(pageText) ? 'temporarily_closed' : 'unknown';
    const rating = card.rating || (pageText.match(/\b([0-5][,.]\d)\b/) || [])[1] || '';
    return {
      ...card,
      ...context,
      name: name || card.name,
      placeId: card.placeId || extractPlaceIdFromUrl(location.href),
      website,
      whatsappUrl: extractWhatsApp(root) || card.whatsappUrl || '',
      address: textOf(addressEl) || card.address || '',
      phone,
      phones,
      category: textOf(categoryEl) || card.category || '',
      categoryPath: (textOf(categoryEl) || card.category || '').split(/\s*[>›|/]\s*/).filter(Boolean),
      emails: [...new Set(emailLinks.map((item) => item.toLowerCase()))],
      socialProfiles: Object.fromEntries([...root.querySelectorAll('a[href]')].map((a) => {
        try { const u = new URL(a.href); const h = u.hostname.replace(/^www\./, '').toLowerCase(); return ['instagram.com','facebook.com','linkedin.com'].some((d) => h === d || h.endsWith('.' + d)) ? [h.split('.').slice(-2, -1)[0], u.href] : null; } catch { return null; }
      }).filter(Boolean)),
      openingHours,
      closedStatus,
      ratingHistory: rating ? [{ rating: String(rating).replace(',', '.'), reviewCount: card.reviewCount || '', checkedAt: new Date().toISOString() }] : [],
      sourceMap: { name: 'google_maps', category: 'google_maps', address: 'google_maps', phone: 'google_maps', rating: 'google_maps', website: 'google_maps' },
      confidence: { name: 'high', category: 'high', address: addressEl ? 'high' : 'medium', phone: phone ? 'high' : 'unknown', website: websiteLink ? 'high' : 'medium' },
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
  async function waitWhilePaused() {
    while (activeCapturePaused) {
      throwIfCaptureCancelled();
      reportProgress({ name: 'Coleta pausada pelo usuário' });
      await sleep(250);
    }
    throwIfCaptureCancelled();
  }
  function detectMapsRestriction() {
    const pathBlocked = /\/sorry\//i.test(location.pathname);
    const challenge = !!document.querySelector('iframe[src*="recaptcha"], #captcha, form[action*="Captcha"], [id*="captcha"]');
    const pageText = clean(document.body?.innerText || document.body?.textContent || '').slice(0, 12000);
    const message = pageText.match(/unusual traffic|tráfego incomum|our systems have detected|automated queries|consultas automatizadas|não foi possível processar sua solicitação/i);
    return pathBlocked || challenge || !!message;
  }
  async function waitForResults(timeout = 30000) {
    const started = Date.now();
    let wakeObserver = null;
    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => wakeObserver?.()) : null;
    try {
      observer?.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      while (Date.now() - started < timeout) {
        throwIfCaptureCancelled();
        await waitWhilePaused();
        if (detectMapsRestriction()) {
          throw new Error('O Google Maps apresentou uma verificação, CAPTCHA ou limitação de acesso. A coleta foi interrompida sem tentar contornar a proteção.');
        }
        const feed = getFeed();
        if (feed && collectCards().length) return feed;
        await new Promise((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (wakeObserver === finish) wakeObserver = null;
            resolve();
          };
          const timer = setTimeout(finish, 350);
          wakeObserver = finish;
        });
      }
    } finally {
      observer?.disconnect();
      wakeObserver = null;
    }
    const diagnostics = getResultDiagnostics();
    throw new Error(
      'Não reconheci cartões de empresas no Google Maps após 30 segundos. ' +
      'Diagnóstico: ' + diagnostics.businessLinks + ' link(s) de ficha, ' +
      diagnostics.visibleContainers + ' contêiner(es) visível(is). ' +
      'A página pode estar em uma tela de verificação ou a estrutura do Maps mudou.'
    );
  }
  async function waitForDetail(expectedName, expectedUrl = '', timeout = 6500) {
    const started = Date.now();
    const expected = clean(expectedName).toLowerCase();
    let matchingHeadingSamples = 0;
    let targetPath = '';
    try { targetPath = new URL(expectedUrl, location.href).pathname.replace(/\/$/, ''); } catch {}
    while (Date.now() - started < timeout) {
      throwIfCaptureCancelled();
      await waitWhilePaused();
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
      await waitWhilePaused();
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

  async function captureVisibleBusinesses(limit = 40, minRating = 0, context = {}, skipPlaceIds = [], skipMapsUrls = []) {
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
    const knownPlaceIds = new Set(Array.isArray(skipPlaceIds) ? skipPlaceIds : []);
    const knownMapsUrls = new Set(Array.isArray(skipMapsUrls) ? skipMapsUrls : []);
    const skippedKnown = new Set();
    let filteredOut = 0, stagnantRounds = 0, scrollRounds = 0, sentCount = 0;
    let stopReason = '';

    while ((unlimited || collected.length < maxLeads) &&
           scrollRounds < (unlimited ? 2000 : 180) && stagnantRounds < 6) {
      throwIfCaptureCancelled();
      await waitWhilePaused();
      if (detectMapsRestriction()) {
        stopReason = 'O Google Maps apresentou uma verificação ou limitação de acesso; a coleta foi interrompida.';
        break;
      }
      const feed = getFeed();
      if (!feed) { stopReason = 'A lista de resultados deixou de estar disponível.'; break; }
      const cards = collectCards();
      for (const item of cards) {
        const key = item.placeId || item.mapsUrl;
        if (key && ((item.placeId && knownPlaceIds.has(item.placeId)) ||
            (item.mapsUrl && knownMapsUrls.has(item.mapsUrl)))) skippedKnown.add(key);
      }
      const basic = cards.find((item) => {
        const key = item.mapsUrl || item.name + '|' + item.address;
        if (!key || processed.has(key)) return false;
        if (item.placeId && knownPlaceIds.has(item.placeId)) return false;
        if (item.mapsUrl && knownMapsUrls.has(item.mapsUrl)) return false;
        return true;
      });

      if (basic) {
        const key = basic.mapsUrl || basic.name + '|' + basic.address;
        processed.add(key);
        const rating = Number(String(basic.rating || '').replace(',', '.'));
        if (threshold > 0 && (!basic.rating || !Number.isFinite(rating) || rating < threshold)) {
          filteredOut += 1;
          await persistCaptureCheckpoint({
            status: 'running', searchTerm: context.searchTerm || '', city: context.city || '',
            queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
            lastPlaceName: basic.name, lastPlaceId: basic.placeId || '', lastMapsUrl: basic.mapsUrl || '',
            collected: collected.length, filteredOut, scanned: processed.size
          });
          reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Descartado pela nota: ' + basic.name });
          continue;
        }

        let details = { ...basic, ...context, website: '', whatsappUrl: '', emails: [], emailStatus: 'pending' };
        const anchor = [...(getResultAnchors(getFeed() || document))]
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
            let opened = await waitForDetail(basic.name, basic.mapsUrl, 6500);
            if (!opened && !isPlaceRoute() && location.href === previousUrl) {
              reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Tentando abrir novamente: ' + basic.name });
              const retryAnchor = [...getResultAnchors(getFeed() || document)].find((node) => absolute(node.href) === basic.mapsUrl && isRendered(node));
              if (retryAnchor) {
                retryAnchor.click();
                opened = await waitForDetail(basic.name, basic.mapsUrl, 8500);
              }
            }
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
              if (collected.length > sentCount) {
                await sendCaptureBatch(collected.slice(sentCount));
                sentCount = collected.length;
              }
              await persistCaptureCheckpoint({
                status: 'interrupted', searchTerm: context.searchTerm || '', city: context.city || '',
                queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
                lastPlaceName: basic.name, lastPlaceId: basic.placeId || '', lastMapsUrl: basic.mapsUrl || '',
                collected: collected.length, filteredOut, scanned: processed.size,
                stopReason: 'Não foi possível retornar à lista após: ' + basic.name
              });
              stopReason = 'Não foi possível retornar à lista após: ' + basic.name;
              break;
            }
          } catch (error) {
            details.captureNote = [details.captureNote, error?.message || 'Falha durante a abertura ou leitura da ficha.'].filter(Boolean).join(' ');
            if (activeCaptureCancelled) {
              collected.push(details);
              if (collected.length > sentCount) {
                await sendCaptureBatch(collected.slice(sentCount));
                sentCount = collected.length;
              }
              await persistCaptureCheckpoint({
                status: 'interrupted', searchTerm: context.searchTerm || '', city: context.city || '',
                queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
                lastPlaceName: basic.name, lastPlaceId: basic.placeId || '', lastMapsUrl: basic.mapsUrl || '',
                collected: collected.length, filteredOut, scanned: processed.size,
                stopReason: 'Coleta cancelada durante a leitura de uma ficha.'
              });
              stopReason = 'Coleta cancelada pelo usuário. O último cartão iniciado foi salvo com os dados disponíveis.';
              break;
            }
            if (isPlaceRoute() || location.href !== previousUrl) {
              const returned = await returnToResults(previousUrl);
              if (!returned) {
                collected.push(details);
                if (collected.length > sentCount) {
                  await sendCaptureBatch(collected.slice(sentCount));
                  sentCount = collected.length;
                }
                await persistCaptureCheckpoint({
                  status: 'interrupted', searchTerm: context.searchTerm || '', city: context.city || '',
                  queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
                  lastPlaceName: basic.name, lastPlaceId: basic.placeId || '', lastMapsUrl: basic.mapsUrl || '',
                  collected: collected.length, filteredOut, scanned: processed.size,
                  stopReason: 'Falha ao retornar aos resultados depois de: ' + basic.name
                });
                stopReason = 'Falha ao retornar aos resultados depois de: ' + basic.name;
                break;
              }
            }
          }
        } else {
          details.captureNote = 'O cartão não estava mais disponível na lista visível.';
        }

        collected.push(details);
        reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Salvando lead: ' + basic.name });
        if (collected.length > sentCount) {
          await sendCaptureBatch(collected.slice(sentCount));
          sentCount = collected.length;
        }
        await persistCaptureCheckpoint({
          status: 'running', searchTerm: context.searchTerm || '', city: context.city || '',
          queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
          lastPlaceName: basic.name, lastPlaceId: basic.placeId || '', lastMapsUrl: basic.mapsUrl || '',
          collected: collected.length, filteredOut, scanned: processed.size
        });
        reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Lead salvo: ' + basic.name });
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
        await waitWhilePaused();
        await sleep(300);
        const currentFeed = getFeed();
        if (!currentFeed) break;
        const currentCards = collectCards();
        const hasUnseen = currentCards.some((item) => {
          const nextKey = item.mapsUrl || item.name + '|' + item.address;
          const alreadySaved = (item.placeId && knownPlaceIds.has(item.placeId)) ||
            (item.mapsUrl && knownMapsUrls.has(item.mapsUrl));
          return nextKey && !processed.has(nextKey) && !alreadySaved;
        });
        if (hasUnseen || currentFeed.scrollHeight > beforeHeight) { foundMore = true; break; }
      }
      const afterFeed = getFeed();
      if (!afterFeed) { stopReason = 'A lista de resultados desapareceu durante a rolagem.'; break; }
      const moved = afterFeed.scrollTop !== beforeTop;
      stagnantRounds = foundMore || moved ? 0 : stagnantRounds + 1;
    }

    if (!stopReason) {
      const scrollLimit = unlimited ? 2000 : 180;
      if (!unlimited && collected.length >= maxLeads) {
        stopReason = 'Quantidade solicitada atingida.';
      } else if (stagnantRounds >= 6) {
        stopReason = 'O Google Maps não apresentou novos cartões após seis tentativas de rolagem.';
      } else if (scrollRounds >= scrollLimit) {
        stopReason = 'Limite de segurança de rolagem atingido.';
      } else if (unlimited) {
        stopReason = 'A lista não apresentou novos cartões.';
      }
    }

    if (sentCount < collected.length) {
      reportProgress({ done: collected.length + filteredOut, total: progressTotal, name: 'Salvando últimos leads' });
      await sendCaptureBatch(collected.slice(sentCount));
      sentCount = collected.length;
    }
    const interrupted = /cancelad|verificação|limitação|não foi possível retornar|falha ao retornar|desapareceu durante/i.test(stopReason);
    const checkpointStatus = interrupted ? 'interrupted' : ((!unlimited && collected.length < maxLeads) ? 'partial' : 'completed');
    await persistCaptureCheckpoint({
      status: checkpointStatus,
      searchTerm: context.searchTerm || '', city: context.city || '',
      queueItemId: context.queueItemId || '', requested: unlimited ? 0 : maxLeads, minRating: threshold,
      lastPlaceName: collected.at(-1)?.name || '',
      lastPlaceId: collected.at(-1)?.placeId || '',
      lastMapsUrl: collected.at(-1)?.mapsUrl || '',
      collected: collected.length, filteredOut, scanned: processed.size, stopReason
    });
    reportProgress({
      done: collected.length + filteredOut,
      total: progressTotal,
      name: stopReason || 'Coleta concluída'
    });
    return {
      items: collected,
      sentCount,
      filteredOut,
      scanned: processed.size,
      skippedExisting: skippedKnown.size,
      requested: unlimited ? 0 : maxLeads,
      remainingToTarget: unlimited ? null : Math.max(0, maxLeads - collected.length),
      scrollRounds,
      stagnantRounds,
      stopReason
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
        city: clean(message.city || ''),
        queueItemId: clean(message.queueItemId || '')
      };

      // Resposta imediata: não manter um canal aberto enquanto o Maps navega
      // entre fichas ou coloca o documento no back/forward cache.
      sendResponse({ ok: true, started: true, taskId });

      Promise.resolve().then(async () => {
        await persistCaptureCheckpoint({
          status: 'running',
          searchTerm: context.searchTerm,
          city: context.city,
          queueItemId: context.queueItemId,
          requested: message.mode === 'open' ? 1 : (Number(message.limit) || 0),
          minRating: Number(message.minRating) || 0,
          collected: 0, filteredOut: 0, scanned: 0
        });
        if (message.mode === 'open') return captureOpenBusiness(context);
        return captureVisibleBusinesses(message.limit, message.minRating, context, message.skipPlaceIds, message.skipMapsUrls);
      }).then(async (result) => {
        const items = Array.isArray(result.items) ? result.items : [];
        if (Number(result.sentCount || 0) < items.length) {
          for (let offset = Number(result.sentCount || 0); offset < items.length; offset += 3) {
            await sendCaptureBatch(items.slice(offset, offset + 3));
          }
        }
        if (message.mode === 'open') {
          const item = items[0] || {};
          await persistCaptureCheckpoint({
            status: 'completed', searchTerm: context.searchTerm, city: context.city,
            queueItemId: context.queueItemId, requested: 1, minRating: Number(message.minRating) || 0,
            collected: items.length, scanned: items.length,
            lastPlaceName: item.name || '', lastPlaceId: item.placeId || '', lastMapsUrl: item.mapsUrl || '',
            stopReason: 'Ficha individual capturada.'
          });
        }
        const { items: _items, sentCount: _sentCount, ...summary } = result;
        await chrome.runtime.sendMessage({
          type: 'PROSPECTRA_CAPTURE_COMPLETE',
          taskId,
          ok: true,
          ...summary
        });
      }).catch(async (error) => {
        await persistCaptureCheckpoint({
          status: 'interrupted',
          searchTerm: context.searchTerm,
          city: context.city,
          queueItemId: context.queueItemId,
          requested: message.mode === 'open' ? 1 : (Number(message.limit) || 0),
          minRating: Number(message.minRating) || 0,
          stopReason: error?.message || 'Coleta interrompida.'
        });
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
        activeCapturePaused = false;
        clearInterval(captureHeartbeatTimer);
        captureHeartbeatTimer = null;
      });

      return false;
    }

    if (message?.type === 'PROSPECTRA_CAPTURE_PAUSE' && message.taskId === activeCaptureTaskId) {
      activeCapturePaused = true;
      sendResponse({ ok: true, paused: true });
      return false;
    }
    if (message?.type === 'PROSPECTRA_CAPTURE_RESUME' && message.taskId === activeCaptureTaskId) {
      activeCapturePaused = false;
      sendResponse({ ok: true, paused: false });
      return false;
    }
    if (message?.type === 'PROSPECTRA_DIAGNOSTICS') {
      const diagnostics = getResultDiagnostics();
      sendResponse({
        ok: true, at: new Date().toISOString(), url: location.href,
        title: document.title, readyState: document.readyState,
        isMaps: validMapsTab(), isBlocked: detectMapsRestriction(),
        diagnostics, userAgent: navigator.userAgent
      });
      return false;
    }
    if (message?.type === 'PROSPECTRA_CAPTURE_CANCEL' &&
        message.taskId === activeCaptureTaskId) {
      activeCaptureCancelled = true;
      activeCapturePaused = false;
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
