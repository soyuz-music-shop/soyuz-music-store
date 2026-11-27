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
    const el=make('article','product-card catalog-card');
    const btn=make('button','catalog-open');btn.type='button';
    btn.append(image(x.image,'catalog-cover',x.name),make('strong','catalog-name',x.name),
      make('span','catalog-media',x.media||'Тип не указан'),make('span','catalog-price',price(x.price_minor)),
      make('span','catalog-availability',availability(x)));
    btn.addEventListener('click',()=>openDetail(x.ean));el.append(btn);return el;
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
  async function openDetail(ean){
    const seq=++detailSeq;detail.replaceChildren(make('p','loading','Загружаем карточку…'));
    if(!dialog.open)dialog.showModal();
    try{
      const x=await get('/item',{ean});if(seq!==detailSeq||!dialog.open)return;
      if(x.ean!==ean||x.can_purchase!==false)throw Error('Unexpected product');
      const wrap=make('div','catalog-detail');
      const gallery=make('div','catalog-gallery');
      const primary=image(x.image,'catalog-detail-image',x.name);gallery.append(primary);
      const thumbs=make('div','catalog-thumbs');
      for(const u of [...new Set([x.image,...(x.images||[])])].filter(Boolean)){
        const b=make('button','catalog-thumb');b.type='button';b.setAttribute('aria-label','Показать фотографию');b.append(image(u,'catalog-thumb-image'));
        b.addEventListener('click',()=>primary.replaceChildren(...image(u,'catalog-detail-image',x.name).childNodes));thumbs.append(b);
      }gallery.append(thumbs);
      const info=make('div','catalog-info');info.append(make('h2','',x.name),make('p','catalog-price',price(x.price_minor)),make('p','',availability(x)),make('p','catalog-sale-off','Оформление заказов пока отключено.'));
      const specs=make('dl','detail-specs');
      for(const [key,label] of Object.entries({ean:'EAN',artist:'Исполнитель',media:'Носитель',edition:'Издание',genre:'Жанр',publisher:'Издатель',country:'Страна',year:'Год',media_qty:'Количество носителей',packaging:'Упаковка',vinyl_color:'Цвет',catalog_number:'Каталожный номер'})){
        if(x[key]!==null&&x[key]!==undefined&&x[key]!==''){specs.append(make('dt','',label),make('dd','',x[key]));}
      }
      info.append(specs);if(x.description)info.append(make('h3','','Описание'),make('p','catalog-description',x.description));
      wrap.append(gallery,info);detail.replaceChildren(wrap);
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
