'use strict';
const q=s=>document.querySelector(s);
const toggle=q('#theme-toggle');
function theme(t){document.documentElement.dataset.theme=t;toggle.setAttribute('aria-pressed',String(t==='dark'));toggle.setAttribute('aria-label',t==='dark'?'Включить светлую тему':'Включить темную тему');}
let saved;try{saved=localStorage.getItem('soyuz-theme');}catch(e){}
theme(saved==='dark'||saved==='light'?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
toggle.addEventListener('click',()=>{let t=document.documentElement.dataset.theme==='dark'?'light':'dark';theme(t);try{localStorage.setItem('soyuz-theme',t);}catch(e){}});
const menu=q('.menu-toggle');menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));q('#main-nav').classList.toggle('open',open);q('#main-nav').classList.toggle('is-open',open);});
q('#main-nav').addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');q('#main-nav').classList.remove('open','is-open');});
q('#year').textContent=String(new Date().getFullYear());
