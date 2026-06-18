
document.addEventListener('DOMContentLoaded',function(){
  var box=document.getElementById('cf-search'),
      out=document.getElementById('cf-search-results');
  if(!box||!out)return;
  function idx(){return window.CF_SEARCH_INDEX||[];}
  function esc(s){return (s||'').replace(/[&<>]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  box.addEventListener('input',function(){
    var q=box.value.trim().toLowerCase();
    if(!q){out.innerHTML='';out.classList.remove('open');return;}
    var terms=q.split(/\s+/).filter(Boolean), hits=[];
    idx().forEach(function(e){
      var t=e.text||'', score=0;
      terms.forEach(function(w){ if(t.indexOf(w)>=0) score++; });
      if(score<terms.length)return;            // every term must appear
      var secs=(e.sections||[]).filter(function(s){
        return terms.some(function(w){return (s.text||'').indexOf(w)>=0;});
      }).slice(0,3);
      hits.push({e:e,score:score,secs:secs});
    });
    hits.sort(function(a,b){return b.score-a.score;});
    if(!hits.length){out.innerHTML="<div class='cf-sr-none'>no matches</div>";
      out.classList.add('open');return;}
    out.innerHTML=hits.slice(0,20).map(function(h){
      var e=h.e,
          url=e.url+(h.secs[0]?('#'+h.secs[0].anchor):''),
          sub=h.secs.map(function(s){
            return "<a class='cf-sr-sec' href='"+e.url+'#'+s.anchor+"'>"
              +"<span class='cf-sr-n'>"+esc(s.number)+"</span>"+esc(s.name)+"</a>";
          }).join('');
      return "<div class='cf-sr-hit'><a class='cf-sr-page' href='"+url+"'>"
        +"<span class='cf-sr-n'>"+esc(e.number)+"</span>"+esc(e.title)+"</a>"+sub+"</div>";
    }).join('');
    out.classList.add('open');
  });
  box.addEventListener('keydown',function(ev){
    if(ev.key==='Escape'){box.value='';out.innerHTML='';out.classList.remove('open');}
  });
});
