(() => {
  const ua = navigator.userAgent || navigator.vendor || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isInApp = /FBAN|FBAV|Instagram|Telegram|VKApp|VK\/|OKApp|TikTok|Twitter|Line\/|MicroMessenger|;\s*wv\)/i.test(ua);
  if (!isInApp || sessionStorage.getItem('soyuz-external-browser-dismissed') === '1') return;

  const banner = document.createElement('aside');
  banner.className = 'external-browser-banner';
  banner.setAttribute('aria-label', 'Открыть сайт во внешнем браузере');
  banner.innerHTML = `
    <div>
      <strong>Откройте магазин в браузере</strong>
      <span>${isIOS ? 'Нажмите кнопку, затем вставьте ссылку в Safari или Chrome.' : 'Так каталог, вход и уведомления будут работать стабильнее.'}</span>
    </div>
    <button class="external-browser-open" type="button">${isIOS ? 'Скопировать ссылку' : 'Открыть в браузере'}</button>
    <button class="external-browser-close" type="button" aria-label="Закрыть">×</button>`;

  const currentUrl = window.location.href;
  banner.querySelector('.external-browser-open').addEventListener('click', async () => {
    if (isAndroid) {
      const target = `${location.host}${location.pathname}${location.search}${location.hash}`;
      window.location.href = `intent://${target}#Intent;scheme=${location.protocol.replace(':', '')};end`;
      return;
    }
    try {
      await navigator.clipboard.writeText(currentUrl);
      banner.querySelector('span').textContent = 'Ссылка скопирована. Откройте Safari или Chrome и вставьте её в адресную строку.';
      banner.querySelector('.external-browser-open').textContent = 'Скопировано ✓';
    } catch (_) {
      window.prompt('Скопируйте ссылку и откройте её в Safari или Chrome:', currentUrl);
    }
  });

  banner.querySelector('.external-browser-close').addEventListener('click', () => {
    sessionStorage.setItem('soyuz-external-browser-dismissed', '1');
    banner.remove();
  });
  document.body.append(banner);
})();
