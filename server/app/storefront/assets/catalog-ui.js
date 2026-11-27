'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const api = '/api/v1/catalog';
  const grid = $('#product-grid'), more = $('#load-more'), dialog = $('#product-dialog');
  const detail = $('#product-detail'), empty = $('#empty-state'), range = $('#price-range');
  const currency = new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:2});
  const price = v => Number.isSafeInteger(v) && v >= 0 ? currency.format(v/100) : 'Цена уточняется';
  const make = (tag, cls, value) => {const e=document.createElement(tag); if(cls)e.className=cls; if(value!==undefined)e.textContent=String(value); return e;};
  const image = (url, cls, alt='') => {
    const box=make('div',cls);
    if(typeof url==='string' && url.startsWith('https://ir.ozone.ru/')){
      const img=make('img'); img.src=url; img.alt=alt; img.loading='lazy'; img.decoding='async'; img.referrerPolicy='no-referrer';
      img.addEventListener('error',()=>{box.replaceChildren(make('span','catalog-image-placeholder','Нет фото'));},{once:true});box.append(img);
    }else box.append(make('span','catalog-image-placeholder','Нет фото'));
    return box;
  };
  async function get(path,params={},signal){
    const res=await fetch(api+path+'?'+new URLSearchParams(params),{signal,cache:'no-store',credentials:'same-origin'});
    if(!res.ok)throw Error('HTTP '+res.status); return res.json();
  }
  let sequence=0, controller, next=null, busy=false, detailSeq=0;
  let ids=new Set(), activeQuery='', activeArtist='', artistExact=false, artistTimer;
  const status = text => $('#catalog-snapshot').textContent=text;
  function params(offset){
    const p={q:activeQuery,artist:activeArtist,artist_exact:artistExact,category:$('input[name=category]:checked').value,
      edition:$('input[name=edition]:checked').value,in_stock:$('#stock-only').checked,sort:$('#sort-select').value,limit:48,offset};
    if(Number(range.value)<Number(range.max))p.max_price_minor=Number(range.value)*100;
    return p;
  }
  const availability = x => x.in_stock_at_snapshot?'В наличии':'Нет в наличии';
  function card(x){
    const name=displayName(x);
    const el=make('article','product-card');el.dataset.category=x.category;el.dataset.product=x.ean;
    el.tabIndex=0;el.setAttribute('aria-label','Подробнее: '+[name.artist,name.title].filter(Boolean).join(' — '));
    const colors={vinyl:'linear-gradient(135deg,#111,#6b5018)',cd:'linear-gradient(135deg,#1d2430,#5f6470)',tape:'linear-gradient(135deg,#111,#b18c30)',book:'linear-gradient(135deg,#171613,#876b32)',movie:'linear-gradient(135deg,#251b1b,#7a2020)'};
    const cover=make('div','cover');cover.style.setProperty('--cover',colors[x.category]||colors.vinyl);cover.dataset.mark=name.artist;
    if(typeof x.image==='string'&&x.image.startsWith('https://ir.ozone.ru/')){
      cover.classList.add('has-image');const img=make('img','cover-image');img.src=x.image;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      img.addEventListener('error',()=>{img.remove();cover.classList.remove('has-image');},{once:true});cover.append(img);
    }
    if(x.is_new===true)cover.append(make('span','badge','Новинка'));
    const info=make('div','product-info'),row=make('div','product-title-row'),copy=make('div','product-title-copy');
    copy.append(make('h3','',name.artist));if(name.title)copy.append(make('h4','',name.title));
    const fav=make('button','favorite-button','♡');fav.type='button';fav.disabled=true;fav.setAttribute('aria-label','Избранное пока не подключено');row.append(copy,fav);info.append(row);
    const details=make('p','album-details'+(name.details?'':' empty'),name.details||'');if(!name.details)details.setAttribute('aria-hidden','true');info.append(details);
    const carrier={vinyl:'LP',cd:'CD',tape:'MC',book:'Книга',movie:'Фильм'}[x.category]||x.media;
    if(carrier){const chips=make('div','chips');chips.append(make('span','',carrier));info.append(chips);}
    const pr=make('div','price-row');pr.append(make('span','price',detailMoney(x.price_minor)),make('span','stock'+(x.in_stock_at_snapshot?'':' out'),availability(x)));info.append(pr);
    const buy=make('button','buy-button',x.in_stock_at_snapshot?'В корзину':'Сообщить о поступлении');buy.type='button';buy.disabled=true;buy.title='Функция пока не подключена';info.append(buy);
    el.append(cover,info);
    el.addEventListener('click',e=>{if(!e.target.closest('button'))openDetail(x.ean);});
    el.addEventListener('keydown',e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(x.ean);}});
    return el;
  }
  async function load(reset=true){
    if(!reset&&(busy||next===null))return;
    if(reset){controller?.abort();controller=new AbortController();ids=new Set();next=null;grid.replaceChildren(make('p','loading','Загружаем каталог…'));empty.hidden=true;}
    const current=++sequence, offset=reset?0:next;
    busy=true;more.disabled=true;more.hidden=true;
    try{
      const data=await get('',params(offset),controller.signal);
      if(current!==sequence)return;
      if(data.sales_enabled!==false||!Array.isArray(data.items)||data.data_mode!=='snapshot')throw Error('Unexpected catalog');
      if(reset)grid.replaceChildren();
      for(const x of data.items)if(!ids.has(x.ean)){ids.add(x.ean);grid.append(card(x));}
      $('#result-count').textContent=String(data.total);
      next=data.next_offset;empty.hidden=data.total!==0;more.hidden=next===null;
    }catch(e){
      if(current!==sequence||e.name==='AbortError')return;
      if(reset){grid.replaceChildren(make('p','loading','Не удалось загрузить каталог.'));$('#result-count').textContent='—';}
      const retry=make('button','load-more','Повторить');retry.type='button';retry.addEventListener('click',()=>{retry.remove();load(reset);},{once:true});grid.append(retry);
    }finally{if(current===sequence){busy=false;more.disabled=false;}}
  }
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
function descriptionPlainText(value) {
  const raw = String(value ?? '').replace(/\r\n?/g, '\n');
  // Parse in inert template only. Never insert imported nodes or attributes into the live DOM.
  const markup = /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>|<!--/i;
  const entities = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i;
  const blocks = new Set(['P','DIV','LI','UL','OL','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','TR','BLOCKQUOTE','PRE','HR']);
  const ignored = new Set(['SCRIPT','STYLE','TEMPLATE','IFRAME','OBJECT','EMBED','SVG','MATH','NOSCRIPT','HEAD']);
  function extract(input) {
    const t = document.createElement('template');
    t.innerHTML = input;
    const out = [];
    function visit(n) {
      if(n.nodeType === 3){out.push(n.nodeValue);return;}
      if(n.nodeType !== 1 && n.nodeType !== 11)return;
      const tag = n.nodeName.toUpperCase();
      if(ignored.has(tag))return;
      if(tag==='BR'){out.push('\n');return;}
      if(blocks.has(tag))out.push('\n');
      for(const child of n.childNodes)visit(child);
      if(blocks.has(tag))out.push('\n');
    }
    visit(t.content);
    return out.join('');
  }
  let clean = raw;
  if(markup.test(raw) || entities.test(raw)) {
    clean = extract(raw);
    // Some upstream descriptions contain escaped HTML line-break tags.
    if(!markup.test(raw) && /<\/?(?:br|p|div|li|ul|ol|strong|b|em|i)(?:\s[^<>]*?)?\s*\/?>/i.test(clean))clean=extract(clean);
  }
  return clean.replace(/\u00a0/g,' ').split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
}

function descriptionHtml(value) {
  const raw = descriptionPlainText(value).trim();
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const heading = raw.match(/трек\s*-?\s*лист\s*:?\s*/i);
  if (!heading) return `<p class="detail-description">${safe(text)}</p>`;

  const intro = raw.slice(0, heading.index).replace(/\s+/g, ' ').trim();
  const trackText = raw.slice(heading.index + heading[0].length).trim();
  let tracks = trackText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (tracks.length < 2) {
    const markers = [...trackText.matchAll(/(?:^|\s)((?:[A-ZА-Я]\s*)?\d{1,3})[.)]\s*/gi)];
    tracks = markers.map((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : trackText.length;
      const title = trackText.slice(start, end).trim();
      return title ? `${marker[1]}. ${title}` : '';
    }).filter(Boolean);
  }
  if (!tracks.length) return `<p class="detail-description">${safe(text)}</p>`;

  return `${intro ? `<p class="detail-description">${safe(intro)}</p>` : ''}
    <div class="tracklist-block">
      <strong>Треклист</strong>
      <div class="tracklist-lines">${tracks.map(track => `<div>${safe(track)}</div>`).join('')}</div>
    </div>`;
}

function displayName(x){
    if(x.display && ['artist','title','details'].every(k=>typeof x.display[k]==='string'))return x.display;
    return {artist:String(x.name||''),title:'',details:''};
  }
  const categories={vinyl:'Винил',cd:'CD',tape:'Кассета',book:'Книга',movie:'Фильм',other:'Товар'};
  const detailMoney=v=>Number.isSafeInteger(v)&&v>=0?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:v%100?2:0,maximumFractionDigits:2}).format(v/100):'Цена уточняется';
  async function openDetail(ean){
    const seq=++detailSeq;detail.replaceChildren(make('p','loading','Загружаем карточку…'));
    if(!dialog.open)dialog.showModal();
    try{
      const x=await get('/item',{ean});if(seq!==detailSeq||!dialog.open)return;
      if(x.ean!==ean||x.can_purchase!==false)throw Error('Unexpected product');
      const name=displayName(x);
      const urls=[...new Set([x.image,...(x.images||[])])].filter(u=>typeof u==='string'&&u.startsWith('https://ir.ozone.ru/'));
      const gallery=make('div','detail-gallery');
      if(urls.length){
        const big=make('img','detail-main-image');big.id='detail-main-image';big.src=urls[0];big.alt=name.title||name.artist;big.referrerPolicy='no-referrer';
        gallery.append(big);
        if(urls.length>1){
          const thumbs=make('div','detail-thumbnails');
          urls.slice(0,10).forEach((url,i)=>{const b=make('button');b.type='button';b.setAttribute('aria-label','Показать фото '+(i+1));b.setAttribute('aria-pressed',String(i===0));
            const img=make('img');img.src=url;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';b.append(img);
            b.addEventListener('click',()=>{big.src=url;for(const t of thumbs.querySelectorAll('button'))t.setAttribute('aria-pressed',String(t===b));});thumbs.append(b);});
          gallery.append(thumbs);
        }
      }else gallery.append(make('div','detail-image-placeholder','Нет изображения'));
      const info=make('div','detail-content');
      info.append(make('p','eyebrow',categories[x.category]||'Товар'),make('h2','',name.artist));
      if(name.title)info.append(make('p','detail-title',name.title));
      if(name.details)info.append(make('p','album-details detail-name-details',name.details));
      const pr=make('div','detail-price-row');
      pr.append(make('strong','',detailMoney(x.price_minor)),make('span','stock'+(x.in_stock_at_snapshot?'':' out'),x.in_stock_at_snapshot?'В наличии':'Нет в наличии'));
      info.append(pr);
      const actions=make('div','detail-actions'),buy=make('button','buy-button',x.in_stock_at_snapshot?'В корзину':'Сообщить о поступлении'),fav=make('button','detail-favorite','♡ В избранное');
      for(const b of [buy,fav]){b.type='button';b.disabled=true;b.title='Функция пока не подключена';actions.append(b);}
      info.append(actions);
      const description=descriptionHtml(x.description);
      const specs=make('dl','detail-specs');
      for(const [key,label] of Object.entries({ean:'EAN',artist:'Исполнитель',media:'Носитель',edition:'Издание',genre:'Жанр',publisher:'Издатель',country:'Страна',year:'Год',media_qty:'Количество носителей',packaging:'Упаковка',vinyl_color:'Цвет',catalog_number:'Каталожный номер'})){
        if(x[key]!==null&&x[key]!==undefined&&x[key]!==''){const row=make('div');row.append(make('dt','',label),make('dd','',x[key]));specs.append(row);}
      }
      const tabs=make('div','detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Информация о товаре');
      const dp=make('section','detail-tab-panel'),sp=make('section','detail-tab-panel');
      dp.id='detail-panel-description';sp.id='detail-panel-specs';
      dp.innerHTML=description||'<p class="detail-empty">Описание пока не добавлено.</p>';
      sp.append(specs.children.length?specs:make('p','detail-empty','Характеристики пока не добавлены.'));
      const buttons=[make('button','detail-tab','Описание'),make('button','detail-tab','Характеристики')],panels=[dp,sp];
      function select(i){buttons.forEach((b,j)=>{b.classList.toggle('active',i===j);b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1;panels[j].hidden=i!==j;});}
      buttons.forEach((b,i)=>{b.type='button';b.id='detail-tab-'+i;b.setAttribute('role','tab');b.setAttribute('aria-controls',panels[i].id);panels[i].setAttribute('role','tabpanel');panels[i].setAttribute('aria-labelledby',b.id);b.addEventListener('click',()=>select(i));b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?1:1-i;select(n);buttons[n].focus();}});tabs.append(b);});
      select(description?0:1);info.append(tabs,dp,sp);
      detail.replaceChildren(gallery,info);
    }catch(e){if(seq===detailSeq&&dialog.open)detail.replaceChildren(make('p','loading','Карточка пока недоступна.'));}
  }
  $('#detail-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{detailSeq++;});
  const artistInput=$('#artist-filter'), artistDropdown=$('#artist-dropdown');
  const artistKey=v=>v.trim().toLocaleLowerCase('ru').replace(/\u0451/g,'\u0435').replace(/\s+/g,' ');
  let artistNames=null, artistError=false, artistRequest=null;
  function showArtist(open){
    artistDropdown.hidden=!open;artistInput.setAttribute('aria-expanded',String(open));
  }
  function renderArtists(){
    artistDropdown.replaceChildren();
    if(artistNames===null){
      artistDropdown.append(make('p','artist-empty',artistError?'Не удалось загрузить список. Повторите поиск.':'Загружаем список…'));return;
    }
    const query=artistKey(artistInput.value),groups=new Map();
    const rank=x=>/[А-Я]/u.test(x)?0:/[A-Z]/u.test(x)?1:/[0-9]/u.test(x)?2:3;
    for(const name of artistNames){
      if(query&&!artistKey(name).includes(query))continue;
      const letter=(name.match(/[\p{L}\d]/u)?.[0]||'#').toLocaleUpperCase('ru').replace(/\u0401/g,'Е');
      if(!groups.has(letter))groups.set(letter,[]);groups.get(letter).push(name);
    }
    for(const [letter,items] of [...groups].sort(([a],[b])=>rank(a)-rank(b)||a.localeCompare(b,'ru'))){
      artistDropdown.append(make('div','artist-letter',letter));
      for(const name of items.sort((a,b)=>a.localeCompare(b,'ru',{sensitivity:'base'}))){
        const button=make('button','artist-option',name);button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(artistExact&&artistKey(activeArtist)===artistKey(name)));
        button.addEventListener('click',()=>{clearTimeout(artistTimer);artistInput.value=name;activeArtist=name;artistExact=true;showArtist(false);artistInput.focus();showArtist(false);load();});
        artistDropdown.append(button);
      }
    }
    if(!groups.size)artistDropdown.append(make('p','artist-empty','Исполнители не найдены'));
  }
  function fetchArtists(){
    if(artistNames!==null||artistRequest)return;
    artistError=false;
    artistRequest=get('/artists').then(d=>{if(!Array.isArray(d.items))throw Error('artists');artistNames=d.items.map(i=>i.name).filter(n=>typeof n==='string');}).catch(()=>{artistError=true;}).finally(()=>{artistRequest=null;renderArtists();});
  }
  artistInput.addEventListener('focus',()=>{showArtist(true);renderArtists();fetchArtists();});
  artistInput.addEventListener('input',()=>{
    clearTimeout(artistTimer);showArtist(true);renderArtists();fetchArtists();
    artistTimer=setTimeout(()=>{activeArtist=artistInput.value.trim();artistExact=false;load();},300);
  });
  artistInput.addEventListener('keydown',e=>{
    if(e.key==='Escape'){showArtist(false);return;}
    if(e.key==='ArrowDown'){e.preventDefault();showArtist(true);artistDropdown.querySelector('button')?.focus();}
    if(e.key==='Enter'){e.preventDefault();clearTimeout(artistTimer);activeArtist=artistInput.value.trim();artistExact=false;showArtist(false);load();}
  });
  artistDropdown.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();artistInput.focus();showArtist(false);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...artistDropdown.querySelectorAll('button')];let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)));buttons[i]?.focus();}
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.artist-combobox'))showArtist(false);});
  $('.artist-combobox').addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))showArtist(false);});
  function resetFilters(keepQuery=false){
    clearTimeout(artistTimer);artistInput.value='';activeArtist='';artistExact=false;showArtist(false);
    if(!keepQuery){$('#header-search').value='';activeQuery='';}
    $('input[name=category][value=all]').checked=true;
    $('input[name=edition][value=all]').checked=true;
    $('#stock-only').checked=false;range.value=range.max;
    $('#price-output').textContent='Любая цена';
  }
  $('#search-form').addEventListener('submit',e=>{e.preventDefault();activeQuery=$('#header-search').value.trim();resetFilters(true);load();$('#catalog').scrollIntoView();});
  $('#header-search').addEventListener('input',e=>{if(!e.target.value&&activeQuery){activeQuery='';load();}});
  for(const el of document.querySelectorAll('input[name=category]:not(:disabled),input[name=edition],#stock-only,#sort-select'))el.addEventListener('change',()=>load());
  range.addEventListener('input',()=>$('#price-output').textContent=Number(range.value)===Number(range.max)?'Любая цена':'до '+currency.format(Number(range.value)));
  range.addEventListener('change',()=>load());more.addEventListener('click',()=>load(false));
  $('#filter-toggle').addEventListener('click',()=>{const f=$('#filters');const open=f.classList.toggle('catalog-filter-open');$('#filter-toggle').setAttribute('aria-expanded',String(open));});
  $('[data-reset-filters]').addEventListener('click',()=>{resetFilters();$('#sort-select').value='new';load();});
  for(const el of document.querySelectorAll('[data-category-jump]:not(:disabled)'))el.addEventListener('click',()=>{const radio=document.querySelector('input[name=category][value="'+el.dataset.categoryJump+'"]');if(radio){radio.checked=true;load();$('#catalog').scrollIntoView();}});
  function initFeatured(config){
    const section=$('#new-carousel'),track=$('#featured-items'),dots=$('#featured-pagination'),prev=$('#featured-prev'),nextButton=$('#featured-next');
    const slides=(Array.isArray(config.slides)?config.slides:[]).filter(s=>s&&typeof s.ean==='string'&&typeof s.image==='string'&&/^\/assets\/new-release-images\/[a-zA-Z0-9._-]+\.webp$/.test(s.image));
    if(!config.enabled||!slides.length){section.hidden=true;return;}
    $('#featured-carousel-title').textContent=config.title||'Новинки';
    const subtitle=$('#featured-carousel-subtitle');subtitle.textContent=config.text||'';subtitle.hidden=!config.text;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const pageSize=()=>innerWidth<700?1:innerWidth<960?2:3;
    let size=pageSize(),page=0,timer=null,hover=false,start=null,ignoreUntil=0;
    const pages=()=>Math.ceil(slides.length/size);
    function stop(){if(timer!==null){clearTimeout(timer);timer=null;}}
    function schedule(){
      stop();
      if(config.autoplay&&pages()>1&&!reduced.matches&&!document.hidden&&!hover&&!section.contains(document.activeElement)&&!dialog.open){
        timer=setTimeout(()=>{page=(page+1)%pages();render();},Math.min(20,Math.max(3,Number(config.intervalSeconds)||5))*1000);
      }
    }
    function render(){
      const focused=document.activeElement,focusedPage=focused?.dataset?.featuredPage,focusedEan=focused?.dataset?.featuredEan;
      page=Math.max(0,Math.min(page,pages()-1));
      const shown=slides.slice(page*size,(page+1)*size);
      track.style.setProperty('--featured-visible-columns',String(shown.length));track.dataset.visibleCount=String(shown.length);
      track.replaceChildren();
      for(const s of shown){
        const b=make('button','featured-item');b.type='button';b.dataset.featuredEan=s.ean;b.setAttribute('aria-label','Открыть карточку: '+[s.artist,s.title].filter(Boolean).join(' — '));
        const imageBox=make('span','featured-image'),picture=make('picture'),img=make('img');img.src=s.image;img.alt='';img.loading='lazy';img.decoding='async';picture.append(img);imageBox.append(picture);
        const copy=make('span','featured-item-text');copy.append(make('strong','featured-item-artist',s.artist||''),make('span','featured-item-album',s.title||''));
        if(s.text)copy.append(make('span','featured-item-description',s.text));b.append(imageBox,copy);track.append(b);
      }
      dots.replaceChildren();
      for(let i=0;i<pages();i++){
        const b=make('button','featured-dot');b.type='button';b.dataset.featuredPage=String(i);b.setAttribute('aria-label','Страница '+(i+1));b.setAttribute('aria-current',String(i===page));dots.append(b);
      }
      prev.disabled=nextButton.disabled=pages()<2;
      if(focusedPage!==undefined)dots.children[Math.min(Number(focusedPage),pages()-1)]?.focus({preventScroll:true});
      if(focusedEan!==undefined){const replacement=[...track.children].find(b=>b.dataset.featuredEan===focusedEan);(replacement||track.firstElementChild)?.focus({preventScroll:true});}
      schedule();
    }
    function move(delta){page=(page+delta+pages())%pages();render();}
    prev.addEventListener('click',()=>move(-1));nextButton.addEventListener('click',()=>move(1));
    dots.addEventListener('click',e=>{const b=e.target.closest('[data-featured-page]');if(b){page=Number(b.dataset.featuredPage);render();}});
    track.addEventListener('click',e=>{if(Date.now()<ignoreUntil){e.preventDefault();return;}const b=e.target.closest('[data-featured-ean]');if(b)openDetail(b.dataset.featuredEan);});
    track.addEventListener('touchstart',e=>{start=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;stop();},{passive:true});
    track.addEventListener('touchcancel',()=>{start=null;schedule();},{passive:true});
    track.addEventListener('touchend',e=>{
      if(!start||e.changedTouches.length!==1){start=null;schedule();return;}
      const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;start=null;
      if(pages()>1&&Math.abs(dx)>=45&&Math.abs(dx)>=Math.abs(dy)*1.3){ignoreUntil=Date.now()+450;move(dx<0?1:-1);}else schedule();
    },{passive:true});
    section.addEventListener('mouseenter',()=>{hover=true;stop();});
    section.addEventListener('mouseleave',()=>{hover=false;schedule();});
    section.addEventListener('focusin',stop);section.addEventListener('focusout',e=>{if(!section.contains(e.relatedTarget))setTimeout(schedule,0);});
    document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);dialog.addEventListener('close',schedule);
    window.addEventListener('resize',()=>{const n=pageSize();if(n!==size){page=Math.floor(page*size/n);size=n;render();}});
    section.hidden=false;render();
  }
  get('/featured').then(initFeatured).catch(()=>{$('#new-carousel').hidden=true;});
  get('/summary').then(s=>{if(s.sales_enabled!==false||s.data_mode!=='snapshot')throw Error('Unexpected summary');$('#hero-count').textContent=s.total+' товаров';for(const el of document.querySelectorAll('[data-count]'))el.textContent=el.dataset.count==='all'?s.total:(s.categories[el.dataset.count]||0);
    if(Number.isSafeInteger(s.max_price_minor)&&s.max_price_minor>=0){
      const unrestricted=Number(range.value)===Number(range.max);
      const oldValue=Number(range.value);
      range.max=String(Math.max(5000,Math.ceil(s.max_price_minor/500000)*5000));
      range.value=unrestricted?range.max:String(Math.min(oldValue,Number(range.max)));
      range.dispatchEvent(new Event('input'));
    }
    const date=new Date(s.imported_at);status('Цены и наличие по импорту '+(Number.isNaN(date.getTime())?'(дата не определена)':date.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК')+'. Продажи отключены.');}).catch(()=>status('Статистика импорта недоступна. Продажи отключены.'));
  load();
})();
