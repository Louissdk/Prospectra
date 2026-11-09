(() => {
  if (window.__prospectraContentLoaded) return;
  window.__prospectraContentLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absolute = (value) => {
    try { return new URL(value, location.href).href; } catch { return ''; }
  };
  const validMapsTab = () => /(^|\.)google\.[^/]+$/.test(location.hostname) && /\/maps/.test(location.pathname);

  function getFeed() {
    return document.querySelector('[role="feed"]') || document.querySelector('div[aria-label*="Results for"], div[aria-label*="Resultados para"]');
  }

  function getCard(anchor) {
    if (!anchor) return null;
    const direct = anchor.closest('[role="article"], .Nv2PK');
    if (direct) return direct;
    let node = anchor;
    for (let depth = 0; depth < 7 && node?.parentElement; depth += 1) {
      node = node.parentElement;
      const text = clean(node.innerText);
      if (text.length > 25 && text.length < 1000 && (node.querySelector('[aria-label*="star"], [aria-label*="estrela"]') || /\d+[,.]\d/.test(text))) return node;
    }
    return anchor.parentElement?.parentElement || anchor;
  }

  function textOf(el) {
    return clean(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '');
  }

  function extractCard(anchor) {
    const card = getCard(anchor);
    const titleEl = card?.querySelector('.qBF1Pd, [class*="fontHeadlineSmall"], [class*="NrDZNb"], h3');
    const ariaName = clean(anchor.getAttribute('aria-label'));
    const name = textOf(titleEl) || ariaName.replace(/\s+\d+(?:[,.]\d+)?\s*stars?.*$/i, '') || textOf(anchor);
    const cardText = clean(card?.innerText || anchor.innerText);
    const phoneMatch = cardText.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
    const ratingMatch = cardText.match(/(?:^|\s)([0-5][,.]\d)(?:\s|$)/);
    const reviewMatch = cardText.match(/\(?([\d.\s]+)\)?\s*(?:reviews?|avaliações?)/i);
    const category = clean(card?.querySelector('[class*="W4Efsd"]')?.innerText?.split('·')?.[0] || '');
    const address = clean(card?.innerText?.split('\n').map((line) => clean(line)).find((line) => /\d+/.test(line) && /[,\-]/.test(line) && line.length > 10) || '');
    return {
      name: name || 'Empresa sem nome identificado',
      category,
      phone: phoneMatch ? clean(phoneMatch[0]) : '',
      address,
      rating: ratingMatch ? ratingMatch[1].replace(',', '.') : '',
      reviewCount: reviewMatch ? reviewMatch[1].replace(/[.\s]/g, '') : '',
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
    const main = document.querySelector('[role="main"]') || document;
    return main;
  }

  function extractDetail(card = {}) {
    const root = detailRoot();
    const heading = root.querySelector('h1');
    const name = textOf(heading) || card.name;
    const websiteLink = root.querySelector('a[data-item-id="authority"], a[aria-label*="Website"], a[aria-label*="website"], a[aria-label*="Site"], a[aria-label*="site"]');
    const rawWebsite = websiteLink?.href || '';
    let website = '';
    try {
      const url = new URL(rawWebsite);
      if (['http:', 'https:'].includes(url.protocol) && !/(^|\.)google\./i.test(url.hostname)) website = url.href;
    } catch {}
    if (!website) {
      const external = [...root.querySelectorAll('a[href^="http"]')].find((a) => {
        try { return !/(^|\.)google\./i.test(new URL(a.href).hostname) && !/goo\.gl|googleadservices/i.test(a.href); }
        catch { return false; }
      });
      if (external) website = external.href;
    }
    const addressEl = root.querySelector('button[data-item-id="address"], button[aria-label*="Address"], button[aria-label*="Endereço"], [data-item-id="address"]');
    const phoneEl = root.querySelector('button[data-item-id^="phone:tel:"], button[aria-label*="Phone"], button[aria-label*="Telefone"], [data-item-id^="phone:tel:"]');
    const categoryEl = root.querySelector('button[jsaction*="category"], [class*="DkEaL"]');
    const emailLinks = [...root.querySelectorAll('a[href^="mailto:"]')].map((a) => a.href.replace(/^mailto:/i, '').split('?')[0]).filter(Boolean);
    return {
      ...card,
      name: name || card.name,
      website,
      address: textOf(addressEl) || card.address || '',
      phone: textOf(phoneEl) || card.phone || '',
      category: textOf(categoryEl) || card.category || '',
      emails: [...new Set(emailLinks.map((item) => item.toLowerCase()))],
      emailStatus: emailLinks.length ? 'found' : (website ? 'pending' : 'no_website')
    };
  }

  async function waitForDetail(previousUrl, timeout = 5500) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const heading = detailRoot().querySelector('h1');
      const hasDetail = heading && clean(heading.textContent).length > 1;
      const urlChanged = location.href !== previousUrl && /\/maps\/place\//.test(location.pathname);
      if (hasDetail || urlChanged) {
        await sleep(350);
        return true;
      }
      await sleep(180);
    }
    return false;
  }

  async function returnToResults() {
    const backButton = [...document.querySelectorAll('button')].find((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
      return /back|voltar|return/i.test(label);
    });
    if (backButton) {
      backButton.click();
      for (let i = 0; i < 30; i += 1) {
        await sleep(180);
        if (getFeed()) return true;
      }
    }
    if (getFeed()) return true;
    try { history.back(); } catch {}
    for (let i = 0; i < 30; i += 1) {
      await sleep(180);
      if (getFeed()) return true;
    }
    return false;
  }

  async function captureOpenBusiness() {
    const details = extractDetail({ mapsUrl: location.href, source: 'Google Maps' });
    if (!details.name || details.name === 'Empresa sem nome identificado') {
      throw new Error('Abra a ficha de uma empresa no Google Maps antes de capturá-la.');
    }
    return [details];
  }

  async function captureVisibleBusinesses(limit = 20) {
    if (!validMapsTab()) throw new Error('Abra uma pesquisa do Google Maps antes de iniciar a coleta.');
    const feed = getFeed();
    if (!feed) throw new Error('Não encontrei a lista de resultados. Faça uma pesquisa no Google Maps e tente novamente.');
    const initialCards = collectCards().slice(0, Math.max(1, Math.min(Number(limit) || 20, 40)));
    if (!initialCards.length) throw new Error('Nenhuma empresa visível foi identificada. Role a lista de resultados para carregar empresas.');

    const collected = [];
    for (let index = 0; index < initialCards.length; index += 1) {
      const basic = initialCards[index];
      chrome.runtime.sendMessage({ type: 'PROSPECTRA_PROGRESS', done: index, total: initialCards.length, name: basic.name }).catch(() => {});
      try {
        const anchor = [...document.querySelectorAll('a[href*="/maps/place/"]')].find((node) => absolute(node.href) === basic.mapsUrl);
        if (anchor) {
          const previousUrl = location.href;
          anchor.scrollIntoView({ block: 'center', behavior: 'auto' });
          await sleep(120);
          anchor.click();
          await waitForDetail(previousUrl);
          collected.push(extractDetail(basic));
          if (index < initialCards.length - 1) {
            const returned = await returnToResults();
            if (!returned) {
              collected[collected.length - 1].captureNote = 'A navegação do Maps não retornou à lista; demais fichas não foram abertas.';
              break;
            }
          }
        } else {
          collected.push({ ...basic, website: '', emails: [], emailStatus: 'no_website', captureNote: 'O cartão deixou de estar disponível durante a coleta.' });
        }
      } catch (error) {
        collected.push({ ...basic, website: '', emails: [], emailStatus: 'pending', captureNote: error?.message || 'Não foi possível abrir esta ficha.' });
      }
    }
    chrome.runtime.sendMessage({ type: 'PROSPECTRA_PROGRESS', done: collected.length, total: initialCards.length, name: '' }).catch(() => {});
    return collected;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PROSPECTRA_CAPTURE') {
      const task = message.mode === 'open'
        ? captureOpenBusiness()
        : captureVisibleBusinesses(message.limit);
      task.then((items) => sendResponse({ ok: true, items }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || 'Falha na coleta.' }));
      return true;
    }
    if (message?.type === 'PROSPECTRA_PING') {
      sendResponse({ ok: true, isMaps: validMapsTab() });
      return false;
    }
    return false;
  });
})();
