
(function(){
  var KEY='cf-nav-scroll';
  function navEl(){return document.querySelector('aside.nav');}
  function save(){var n=navEl();if(n){try{sessionStorage.setItem(KEY,n.scrollTop);}catch(e){}}}
  function restore(){var n=navEl();if(!n)return;try{var v=sessionStorage.getItem(KEY);
    if(v!==null){n.scrollTop=parseInt(v,10)||0;return true;}}catch(e){}return false;}
  document.addEventListener('DOMContentLoaded',function(){
    var had=restore();
    var n=navEl();
    if(n){
      // First visit (no stored pos): bring the active item into view.
      if(!had){var a=n.querySelector('a.active');if(a&&a.scrollIntoView)
        a.scrollIntoView({block:'center'});}
      n.addEventListener('scroll',save,{passive:true});
      n.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a'))save();},true);
    }
    window.addEventListener('beforeunload',save);
    window.addEventListener('pagehide',save);
  });
})();
