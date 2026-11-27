'use strict';
const q=s=>document.querySelector(s);
const toggle=q('#theme-toggle');
const media=matchMedia('(prefers-color-scheme: dark)');
let explicit=false;
function theme(t){
  document.documentElement.dataset.theme=t;
  toggle.dataset.theme=t;
  toggle.setAttribute('aria-pressed',String(t==='dark'));
  toggle.setAttribute('aria-label',t==='dark'?'Включить светлую тему':'Включить темную тему');
  toggle.title=t==='dark'?'Светлая тема':'Темная тема';
  q('#theme-color').content=t==='dark'?'#11100e':'#f6f3ed';
}
let saved;try{saved=localStorage.getItem('soyuz-theme');}catch(e){}
explicit=saved==='dark'||saved==='light';
theme(explicit?saved:(media.matches?'dark':'light'));
toggle.addEventListener('click',()=>{explicit=true;const t=document.documentElement.dataset.theme==='dark'?'light':'dark';theme(t);try{localStorage.setItem('soyuz-theme',t);}catch(e){}});
media.addEventListener('change',()=>{if(!explicit)theme(media.matches?'dark':'light');});
const menu=q('.menu-toggle');menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));q('#main-nav').classList.toggle('open',open);q('#main-nav').classList.toggle('is-open',open);});
q('#main-nav').addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');q('#main-nav').classList.remove('open','is-open');});
q('#year').textContent=String(new Date().getFullYear());
