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
  let ids=new Set();
  const status = text => $('#catalog-snapshot').textContent=text;
  function params(offset){
    const p={q:$('#header-search').value.trim(),category:$('input[name=category]:checked').value,
      in_stock:$('#stock-only').checked,sort:$('#sort-select').value,limit:48,offset};
    if(Number(range.value)<Number(range.max))p.max_price_minor=Number(range.value)*100;
    return p;
  }
  const availability = x => x.in_stock_at_snapshot?'В наличии по снимку':'Нет в наличии по снимку';
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
  const tidy=v=>String(v||'').replace(/\s+/gu,' ').trim();
  const fold=v=>tidy(v).toLocaleLowerCase('ru').replace(/\u0451/g,'\u0435');
  const raw=tidy(x.name);
  // Only strip terminal, balanced parentheses with explicit carrier/edition metadata.
  const format=/^(?:\d*\s*(?:LP|CD|MC|DVD|BD|SACD|Blu[ -]?ray|EP|SP)(?=$|[\s/+,.\d-]|jewel|digi|card|box)|компакт[ -]?диск|аудиокассета|винил|книга|диск\b|бокс[ -]?сет|(?:белая|черная|цветная|красная|прозрачная) кассета)/iu;
  let body=raw,details='';
  for(;;){
    if(!body.endsWith(')'))break;
    let depth=0,i=body.length-1;
    for(;i>=0;i--){if(body[i]===')')depth++;else if(body[i]==='('&&--depth===0)break;}
    if(i<=0||!format.test(body.slice(i+1,-1).trim()))break;
    details=[body.slice(i),details].filter(Boolean).join(' ');body=body.slice(0,i).trimEnd();
  }
  // Confirmed names without an explicit separator, not a generic split on ! or ?.
  const confirmed=['Forward Russia!','Где Фантом?','Пахом Вам Перезвонит','Blind Guardian Twilight Orchestra','AIR French Band','Herman Frank','Nagart','Телевизор','Katatonia','Lord Of The Lost','Лаэртский и Карабас','А. Ф. Скляр и Ва-Банкъ','W.A.S.P.','S.Y.P.H.'];
  const hints=[...String(x.artist||'').split(' · '),...confirmed].map(tidy).filter(Boolean).sort((a,b)=>b.length-a.length);
  const parts=[];let depth=0;
  for(let i=0;i<body.length;i++){
    const ch=body[i];if(ch==='('){depth++;continue;}if(ch===')'){depth=Math.max(0,depth-1);continue;}if(depth)continue;
    const left=body.slice(0,i).trimEnd();
    if(ch==='.'&&/\s/u.test(body[i+1]||'')&&left&&(!left.endsWith('.')||(/(?:[\p{L}]\.){2,}$/u.test(left)&&!left.endsWith('..')))&&!/^(?:\.|\s)*$/u.test(left)&&!/(?:^|\s)(?:[\p{L}]|Dr|Mr|Mrs|Ms|St|DJ|MC|Vol|No|Op|Pt|ч|им)$/iu.test(left)&&!/(?:^|\s)(?:[\p{L}]\.)+[\p{L}]$/u.test(left)){
      parts.push({i,j:i+1,kind:'dot'});
    }else if(/[—–-]/u.test(ch)&&/\s/u.test(body[i-1]||'')&&/\s/u.test(body[i+1]||''))parts.push({i,j:i+1,kind:'dash'});
  }
  const split=(i,j,reason)=>({artist:body.slice(0,i).trim(),title:body.slice(j).trim(),details,reason});
  for(const hint of hints){
    if(!fold(body).startsWith(fold(hint)))continue;
    const rest=body.slice(hint.length);
    if(!rest) return {artist:body,title:'',details,reason:'artist_only'};
    const explicit=/^(?:\s*\.\s*|\s*[—–-]\s*)/u.exec(rest);
    // Do not swallow the initial dot of a title such as ...And The Circus Leaves Town.
    if(explicit&&rest.slice(explicit[0].length).trim()&&!/^\.{2,}/u.test(rest.trimStart()))return split(hint.length,hint.length+explicit[0].length,'hint_delimiter');
    if(/^\s+/u.test(rest)&&rest.trim()&&!/^(?:и|and|with|feat\.?|featuring|&|\+|\/|\()/iu.test(rest.trimStart())){
      const earlier=parts.find(p=>p.kind==='dot');
      // A longer artist credit (e.g. "A & B. Album") should take precedence over a partial hint.
      if(!earlier||earlier.i>=hint.length&&!/^(?:[^.]*\s)?(?:&|\band\b|\bfeat\b|\bи\b)\s/iu.test(body.slice(hint.length,earlier.i).trim()))return split(hint.length,hint.length,'hint_space');
    }
  }
  const dot=parts.find(p=>p.kind==='dot');
  const book=details&&/^\(книга/iu.test(details);
  if(book&&!dot){const dash=parts.find(p=>p.kind==='dash');if(dash&&body.slice(dash.j).trim())return split(dash.i,dash.j,'book_dash');}
  // Compilations / numbered titles must not turn a subtitle into a fictional artist.
  const compilation=/^(?:разные исполнители|various(?: artists)?)$/iu.test(tidy(x.artist))&&!/^various\.\s/iu.test(body);
  if(dot&&!compilation&&body.slice(dot.j).trim())return split(dot.i,dot.j,'dot');
  // An unconfirmed dash is often part of a compilation title: keep it intact.
  return {artist:body,title:'',details,reason:'unsplit'};
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
  $('#search-form').addEventListener('submit',e=>{e.preventDefault();load();$('#catalog').scrollIntoView();});
  for(const el of document.querySelectorAll('input[name=category]:not(:disabled),#stock-only,#sort-select'))el.addEventListener('change',()=>load());
  range.addEventListener('input',()=>$('#price-output').textContent=Number(range.value)===Number(range.max)?'Любая цена':'до '+currency.format(Number(range.value)));
  range.addEventListener('change',()=>load());more.addEventListener('click',()=>load(false));
  $('#filter-toggle').addEventListener('click',()=>{const f=$('#filters');const open=f.classList.toggle('catalog-filter-open');$('#filter-toggle').setAttribute('aria-expanded',String(open));});
  $('[data-reset-filters]').addEventListener('click',()=>{$('#header-search').value='';$('input[name=category][value=all]').checked=true;$('#stock-only').checked=false;range.value=range.max;$('#price-output').textContent='Любая цена';$('#sort-select').value='new';load();});
  for(const el of document.querySelectorAll('[data-category-jump]:not(:disabled)'))el.addEventListener('click',()=>{const radio=document.querySelector('input[name=category][value="'+el.dataset.categoryJump+'"]');if(radio){radio.checked=true;load();$('#catalog').scrollIntoView();}});
  for(const el of document.querySelectorAll('[data-featured-ean]')){el.setAttribute('role','button');el.tabIndex=0;el.addEventListener('click',()=>openDetail(el.dataset.featuredEan));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(el.dataset.featuredEan);}});}
  get('/summary').then(s=>{if(s.sales_enabled!==false||s.data_mode!=='snapshot')throw Error('Unexpected summary');$('#hero-count').textContent=s.total+' товаров';for(const el of document.querySelectorAll('[data-count]'))el.textContent=el.dataset.count==='all'?s.total:(s.categories[el.dataset.count]||0);
    const date=new Date(s.imported_at);status('Цены и наличие по импорту '+(Number.isNaN(date.getTime())?'(дата не определена)':date.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК')+'. Продажи отключены.');}).catch(()=>status('Статистика импорта недоступна. Продажи отключены.'));
  load();
})();
