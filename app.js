let products = [];

const state = {
  search: '',
  category: 'all',
  stockOnly: false,
  maxPrice: 100000,
  sort: 'new',
  favoritesOnly: false,
  visibleCount: 48,
  favorites: new Set(JSON.parse(localStorage.getItem('soyuz-favorites') || '[]')),
  cart: JSON.parse(localStorage.getItem('soyuz-cart') || '[]')
};

const el = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const safe = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const categoryName = { vinyl: 'Винил', cd: 'CD', tape: 'Кассета', book: 'Книга', movie: 'Фильм' };
const categoryColor = {
  vinyl: 'linear-gradient(135deg,#111,#6b5018)',
  cd: 'linear-gradient(135deg,#1d2430,#5f6470)',
  tape: 'linear-gradient(135deg,#111,#b18c30)',
  book: 'linear-gradient(135deg,#171613,#876b32)',
  movie: 'linear-gradient(135deg,#251b1b,#7a2020)'
};

function filteredProducts() {
  const query = state.search.trim().toLocaleLowerCase('ru');
  const result = products.filter(product => {
    const searchable = `${product.artist} ${product.title} ${product.format} ${product.genre} ${product.publisher}`.toLocaleLowerCase('ru');
    return (!query || searchable.includes(query))
      && (state.category === 'all' || product.category === state.category)
      && (!state.stockOnly || product.available !== false)
      && product.price <= state.maxPrice
      && (!state.favoritesOnly || state.favorites.has(product.id));
  });
  result.sort((a, b) => {
    if (state.sort === 'price-asc') return a.price - b.price;
    if (state.sort === 'price-desc') return b.price - a.price;
    if (state.sort === 'title') return `${a.artist}${a.title}`.localeCompare(`${b.artist}${b.title}`, 'ru');
    return (b.year || 0) - (a.year || 0);
  });
  return result;
}

function productCard(product) {
  const favorite = state.favorites.has(product.id);
  const available = product.available !== false;
  const cover = product.image
    ? `<img class="cover-image" src="${safe(product.image)}" alt="" loading="lazy" decoding="async">`
    : '';
  const chip = product.format || product.detail || '';
  return `<article class="product-card" data-category="${safe(product.category)}" data-product="${safe(product.id)}" tabindex="0" aria-label="Подробнее: ${safe(product.artist)} — ${safe(product.title)}">
    <div class="cover ${product.image ? 'has-image' : ''}" style="--cover:${categoryColor[product.category]}" data-mark="${safe(product.artist)}">
      ${cover}
      ${product.badge ? `<span class="badge">${safe(product.badge)}</span>` : ''}
    </div>
    <div class="product-info">
      <div class="product-title-row"><h3>${safe(product.artist)}</h3><button class="favorite-button ${favorite ? 'active' : ''}" type="button" data-favorite="${safe(product.id)}" aria-label="${favorite ? 'Убрать из избранного' : 'Добавить в избранное'}">${favorite ? '♥' : '♡'}</button></div>
      <p class="album">${safe(product.title)}</p>
      <div class="chips"><span>${categoryName[product.category]}</span>${chip ? `<span>${safe(chip)}</span>` : ''}</div>
      <div class="price-row"><span class="price">${money(product.price)}</span><span class="stock ${available ? '' : 'out'}">${available ? '✓ В продаже' : 'Нет в наличии'}</span></div>
      <button class="buy-button" type="button" data-buy="${safe(product.id)}" ${available ? '' : 'disabled'}>${available ? 'В корзину' : 'Сообщить о поступлении'}</button>
    </div>
  </article>`;
}

let openProductId = null;

function openProduct(product) {
  if (!product) return;
  openProductId = product.id;
  const favorite = state.favorites.has(product.id);
  const images = (product.images?.length ? product.images : [product.image]).filter(Boolean);
  const specs = Object.entries(product.specs || {});
  const description = safe(product.description || '').replace(/\n/g, '<br>');
  el('#product-detail').innerHTML = `
    <div class="detail-gallery">
      ${images[0] ? `<img class="detail-main-image" id="detail-main-image" src="${safe(images[0])}" alt="${safe(product.title)}">` : '<div class="detail-image-placeholder">Нет изображения</div>'}
      ${images.length > 1 ? `<div class="detail-thumbnails">${images.slice(0, 10).map((image, index) => `<button type="button" data-detail-image="${safe(image)}" aria-label="Показать фото ${index + 1}"><img src="${safe(image)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
    <div class="detail-content">
      <p class="eyebrow">${safe(categoryName[product.category] || 'Товар')}</p>
      <h2>${safe(product.artist)}</h2>
      <p class="detail-title">${safe(product.title)}</p>
      <div class="detail-price-row"><strong>${money(product.price)}</strong><span class="stock">✓ В продаже</span></div>
      <div class="detail-actions">
        <button class="buy-button" type="button" data-buy="${safe(product.id)}">В корзину</button>
        <button class="detail-favorite ${favorite ? 'active' : ''}" type="button" data-favorite="${safe(product.id)}">${favorite ? '♥ В избранном' : '♡ В избранное'}</button>
      </div>
      ${description ? `<section class="detail-section"><h3>Описание</h3><p class="detail-description">${description}</p></section>` : ''}
      ${specs.length ? `<section class="detail-section"><h3>Характеристики</h3><dl class="detail-specs">${specs.map(([label, value]) => `<div><dt>${safe(label)}</dt><dd>${safe(value)}</dd></div>`).join('')}</dl></section>` : ''}
    </div>`;
  if (!el('#product-dialog').open) el('#product-dialog').showModal();
}

function render() {
  const result = filteredProducts();
  el('#product-grid').innerHTML = result.slice(0, state.visibleCount).map(productCard).join('');
  el('#result-count').textContent = result.length;
  el('#empty-state').hidden = result.length !== 0;
  el('#load-more').hidden = state.visibleCount >= result.length;
  el('#favorite-count').textContent = state.favorites.size;
  el('#cart-count').textContent = state.cart.length;
  el('#favorites-button').classList.toggle('selected', state.favoritesOnly);
}

function persist() {
  localStorage.setItem('soyuz-favorites', JSON.stringify([...state.favorites]));
  localStorage.setItem('soyuz-cart', JSON.stringify(state.cart));
}

let toastTimer;
function toast(message) {
  const node = el('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1800);
}

document.addEventListener('click', event => {
  const favorite = event.target.closest('[data-favorite]');
  const buy = event.target.closest('[data-buy]');
  const jump = event.target.closest('[data-category-jump]');
  const detailImage = event.target.closest('[data-detail-image]');
  const card = event.target.closest('[data-product]');
  if (favorite) {
    const id = favorite.dataset.favorite;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    persist();
    render();
    if (el('#product-dialog')?.open && openProductId === id) openProduct(products.find(item => item.id === id));
    return;
  }
  if (buy) {
    const product = products.find(item => item.id === buy.dataset.buy);
    if (!product) return;
    state.cart.push(product.id);
    persist();
    render();
    toast(`${product.artist} — добавлено в корзину`);
    return;
  }
  if (jump) {
    const input = document.querySelector(`input[name="category"][value="${jump.dataset.categoryJump}"]`);
    input.checked = true;
    state.category = input.value;
    state.visibleCount = 48;
    render();
    el('#catalog').scrollIntoView();
    return;
  }
  if (detailImage) {
    el('#detail-main-image').src = detailImage.dataset.detailImage;
    return;
  }
  if (card) openProduct(products.find(item => item.id === card.dataset.product));
});

document.addEventListener('keydown', event => {
  const card = event.target.closest?.('[data-product]');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openProduct(products.find(item => item.id === card.dataset.product));
  }
});

all('input[name="category"]').forEach(input => input.addEventListener('change', () => {
  state.category = input.value;
  state.visibleCount = 48;
  render();
}));
el('#stock-only').addEventListener('change', event => {
  state.stockOnly = event.target.checked;
  state.visibleCount = 48;
  render();
});
el('#price-range').addEventListener('input', event => {
  state.maxPrice = Number(event.target.value);
  state.visibleCount = 48;
  el('#price-output').textContent = money(state.maxPrice);
  render();
});
el('#sort-select').addEventListener('change', event => {
  state.sort = event.target.value;
  state.visibleCount = 48;
  render();
});
el('#header-search').addEventListener('input', event => {
  state.search = event.target.value;
  state.visibleCount = 48;
  render();
});
el('#favorites-button').addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  state.visibleCount = 48;
  render();
  el('#catalog').scrollIntoView();
});
el('#reset-filters').addEventListener('click', () => {
  const maxPrice = Number(el('#price-range').max);
  state.search = '';
  state.category = 'all';
  state.stockOnly = false;
  state.maxPrice = maxPrice;
  state.favoritesOnly = false;
  state.visibleCount = 48;
  el('#header-search').value = '';
  el('#stock-only').checked = false;
  el('#price-range').value = maxPrice;
  el('#price-output').textContent = money(maxPrice);
  document.querySelector('input[name="category"][value="all"]').checked = true;
  render();
});
el('#filter-toggle').addEventListener('click', () => el('#filters').classList.toggle('open'));
el('#load-more').addEventListener('click', () => {
  state.visibleCount += 48;
  render();
});
el('.menu-toggle').addEventListener('click', event => {
  const open = el('#main-nav').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

function renderCart() {
  const counts = state.cart.reduce((acc, id) => ((acc[id] = (acc[id] || 0) + 1), acc), {});
  const lines = Object.entries(counts).map(([id, count]) => {
    const product = products.find(item => item.id === id);
    if (!product) return '';
    return `<div class="cart-line"><span><b>${safe(product.artist)}</b><br><small>${safe(product.title)}</small></span><span>${count} × ${money(product.price)}</span><button type="button" data-remove="${safe(id)}">Удалить</button></div>`;
  });
  el('#cart-items').innerHTML = lines.join('') || '<p>Корзина пока пуста.</p>';
  el('#cart-total').textContent = money(state.cart.reduce((sum, id) => sum + (products.find(product => product.id === id)?.price || 0), 0));
}

el('#cart-button').addEventListener('click', () => {
  renderCart();
  el('#cart-dialog').showModal();
});
el('.cart-dialog .close-button').addEventListener('click', () => el('#cart-dialog').close());
el('.product-close').addEventListener('click', () => el('#product-dialog').close());
el('#cart-items').addEventListener('click', event => {
  const remove = event.target.closest('[data-remove]');
  if (!remove) return;
  const index = state.cart.indexOf(remove.dataset.remove);
  if (index >= 0) state.cart.splice(index, 1);
  persist();
  render();
  renderCart();
});
el('.checkout-button').addEventListener('click', () => toast('Ozon Pay будет подключён после получения токена'));
el('#year').textContent = new Date().getFullYear();

async function loadProducts() {
  try {
    const response = await fetch('products.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    products = await response.json();
    const validIds = new Set(products.map(product => product.id));
    state.cart = state.cart.filter(id => validIds.has(id));
    state.favorites = new Set([...state.favorites].filter(id => validIds.has(id)));
    const counts = products.reduce((acc, product) => {
      acc[product.category] = (acc[product.category] || 0) + 1;
      return acc;
    }, {});
    all('[data-count]').forEach(node => {
      node.textContent = node.dataset.count === 'all' ? products.length : (counts[node.dataset.count] || 0);
    });
    const maxPrice = Math.ceil(Math.max(...products.map(product => product.price), 1000) / 5000) * 5000;
    el('#price-range').max = maxPrice;
    el('#price-range').value = maxPrice;
    state.maxPrice = maxPrice;
    el('#price-output').textContent = money(maxPrice);
    persist();
    render();
  } catch (error) {
    el('#product-grid').innerHTML = '<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    console.error(error);
  }
}

loadProducts();
