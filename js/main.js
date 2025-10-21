// main.js - cleaned consolidated implementation
// Map + Markers + Heatmap + Donut + Bar + Filters + Export + Help + Tooltips

document.addEventListener('DOMContentLoaded', function () {
  // Quick dependency checks
  if (typeof L === 'undefined') { console.error('Leaflet missing'); return; }
  if (typeof d3 === 'undefined') { console.error('D3 missing'); return; }

  // Map init
  var initialCenter = [38.9072, -77.0369];
  var initialZoom = 12;
  var map = L.map('map').setView(initialCenter, initialZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '' }).addTo(map);
  map.createPane('polygonsPane'); map.getPane('polygonsPane').style.zIndex = 320;
  map.createPane('markersPane'); map.getPane('markersPane').style.zIndex = 650;

  var crashIcon = L.icon({ iconUrl: 'img/crash.png', iconSize: [40,50], iconAnchor: [15,15] });

  // State
  var csvData = [];
  var allYears = [];
  var markersCluster = null;

  // Render filter controls (ensure #filters exists in HTML)
  var filtersDiv = document.getElementById('filters');
  filtersDiv.innerHTML = `
    <label for="yearFilter">Select Year:</label>
    <select id="yearFilter"><option value="">-- All --</option></select>
    &nbsp;&nbsp;
    <label for="wardFilter">Ward:</label>
    <select id="wardFilter"><option value="">-- All --</option></select>
    &nbsp;&nbsp;
    <label for="injuryFilter">Injury Severity:</label>
    <select id="injuryFilter">
      <option value="all">All</option>
      <option value="high">High</option>
      <option value="low">Low</option>
      <option value="none">None</option>
    </select>
    &nbsp;&nbsp;
    <label><input type="checkbox" id="fatalityFilter"> Fatalities Only</label>
    &nbsp;&nbsp;
    <label><input type="checkbox" id="pedestrianFilter"> Pedestrian Involved</label>
    &nbsp;&nbsp;
    <label><input type="checkbox" id="bicyclistFilter"> Bicyclist Involved</label>
  `;

  var exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-primary mt-2'; exportBtn.id = 'exportDataButton'; exportBtn.innerText = 'Export Data';
  filtersDiv.appendChild(exportBtn);

  var selectYear = document.getElementById('yearFilter');
  var selectWard = document.getElementById('wardFilter');
  var selectInjury = document.getElementById('injuryFilter');
  var checkboxFatalities = document.getElementById('fatalityFilter');
  var checkboxPedestrians = document.getElementById('pedestrianFilter');
  var checkboxBicyclists = document.getElementById('bicyclistFilter');

  // Help button (in HTML footer of filters card)
  var helpBtn = document.getElementById('helpButton');

  // Load data
  d3.csv('data/crash.csv').then(function(data){
    csvData = data.map(function(d){ d.year = (d.DATE && d.DATE.length>=4) ? d.DATE.substring(0,4) : (d.year||''); return d; });
    csvData = csvData.filter(function(d){ return d.year !== '2018'; });

    var years = new Set(csvData.map(function(d){ return d.year; }));
    allYears = Array.from(years).sort();
    allYears.forEach(function(y){ var o=document.createElement('option'); o.value=y; o.textContent=y; selectYear.appendChild(o); });

    var wards = new Set(csvData.map(function(d){ return d.WARD; }).filter(Boolean));
    Array.from(wards).sort().forEach(function(w){ var o=document.createElement('option'); o.value=w; o.textContent=w; selectWard.appendChild(o); });

    // Initial render
    renderAll();
  }).catch(function(err){ console.error('CSV load failed', err); });

  // Filtering helpers
  function buildFilteredForMap(){
    var selY=selectYear.value, selW=selectWard.value, inj=selectInjury.value;
    return csvData.filter(function(d){
      if (selY && d.year!==selY) return false;
      if (selW && d.WARD!==selW) return false;
      if (checkboxFatalities.checked){ var tf=(+d.FATAL_DRIVER||0)+(+d.FATAL_PEDESTRIAN||0)+(+d.FATAL_BICYCLIST||0); if(tf===0) return false; }
      if (checkboxPedestrians.checked && (+d.TOTAL_PEDESTRIANS||0)===0) return false;
      if (checkboxBicyclists.checked && (+d.TOTAL_BICYCLES||0)===0) return false;
      if (inj!=='all'){ var maj=(+d.MAJORINJURIES_DRIVER||0)+(+d.MAJORINJURIES_PEDESTRIAN||0)+(+d.MAJORINJURIES_BICYCLIST||0); var min=(+d.MINORINJURIES_DRIVER||0)+(+d.MINORINJURIES_PEDESTRIAN||0)+(+d.MINORINJURIES_BICYCLIST||0); if(inj==='high' && maj===0) return false; if(inj==='low' && (maj>0||min===0)) return false; if(inj==='none' && (maj>0||min>0)) return false; }
      return true;
    });
  }
  function buildFilteredForDonut(){ return buildFilteredForMap(); }
  function buildFilteredForBar(){
    var selW=selectWard.value, inj=selectInjury.value;
    return csvData.filter(function(d){ if(selW && d.WARD!==selW) return false; if(checkboxFatalities.checked){ var tf=(+d.FATAL_DRIVER||0)+(+d.FATAL_PEDESTRIAN||0)+(+d.FATAL_BICYCLIST||0); if(tf===0) return false;} if(checkboxPedestrians.checked && (+d.TOTAL_PEDESTRIANS||0)===0) return false; if(checkboxBicyclists.checked && (+d.TOTAL_BICYCLES||0)===0) return false; if(inj!=='all'){ var maj=(+d.MAJORINJURIES_DRIVER||0)+(+d.MAJORINJURIES_PEDESTRIAN||0)+(+d.MAJORINJURIES_BICYCLIST||0); var min=(+d.MINORINJURIES_DRIVER||0)+(+d.MINORINJURIES_PEDESTRIAN||0)+(+d.MINORINJURIES_BICYCLIST||0); if(inj==='high'&&maj===0) return false; if(inj==='low'&&(maj>0||min===0)) return false; if(inj==='none'&&(maj>0||min>0)) return false;} return true; });
  }

  // Render everything
  function renderAll(){
    var mapData = buildFilteredForMap(); renderMap(mapData);
    var donut = buildFilteredForDonut(); updateDonutChart(donut);
    var bar = buildFilteredForBar(); updateBarChart(bar);
  updateKPICards(donut);
  }

  // Map markers
  function renderMap(data){ if(markersCluster){ try{ map.removeLayer(markersCluster);}catch(e){} markersCluster=null;} markersCluster=L.markerClusterGroup({pane:'markersPane',showCoverageOnHover:false}); data.map(function(d){ var lat=+d.LATITUDE,lng=+d.LONGITUDE; if(!isNaN(lat)&&!isNaN(lng)) return {d:d,lat:lat,lng:lng}; }).filter(Boolean).forEach(function(f){ var m=L.marker([f.lat,f.lng],{icon:crashIcon}); var p=f.d; var popup='<h4>Crash Details</h4>'+(p.DATE?('<strong>DATE:</strong> '+p.DATE+'<br/>'):'')+(p.ADDRESS?('<strong>ADDRESS:</strong> '+p.ADDRESS+'<br/>'):'')+(p.WARD?('<strong>WARD:</strong> '+p.WARD+'<br/>'):'' ); m.bindPopup(popup); markersCluster.addLayer(m); }); map.addLayer(markersCluster); }

  // (Heatmap removed) The application uses marker clustering only to avoid heatmap-related issues.

  // Donut
  function updateDonutChart(filteredData){ var severity={Fatal:0,Major:0,Minor:0,None:0}; filteredData.forEach(function(d){ var fat=(+d.FATAL_DRIVER||0)+(+d.FATAL_PEDESTRIAN||0)+(+d.FATAL_BICYCLIST||0); var maj=(+d.MAJORINJURIES_DRIVER||0)+(+d.MAJORINJURIES_PEDESTRIAN||0)+(+d.MAJORINJURIES_BICYCLIST||0); var min=(+d.MINORINJURIES_DRIVER||0)+(+d.MINORINJURIES_PEDESTRIAN||0)+(+d.MINORINJURIES_BICYCLIST||0); if(fat>0) severity.Fatal++; else if(maj>0) severity.Major++; else if(min>0) severity.Minor++; else severity.None++; }); var data=Object.keys(severity).map(function(k){return {category:k,count:severity[k]};}); var container=document.getElementById('donutChart'); d3.select('#donutChart').select('svg').remove(); var width=container.clientWidth,height=300,radius=Math.min(width,height)/2-10; var svg=d3.select('#donutChart').append('svg').attr('width','100%').attr('height',height).append('g').attr('transform','translate('+(width/2)+','+(height/2)+')'); var color=d3.scaleOrdinal().domain(data.map(function(d){return d.category;})).range(['#d73027','#fc8d59','#fee08b','#91bfdb']); var pie=d3.pie().value(function(d){return d.count;}).sort(null); var arc=d3.arc().innerRadius(radius*0.5).outerRadius(radius*0.9); var g=svg.selectAll('.arc').data(pie(data)).enter().append('g').attr('class','arc'); g.append('path').attr('d',arc).attr('fill',function(d){return color(d.data.category);}); svg.append('text').attr('y',-height/2+18).attr('text-anchor','middle').text('Crash Severity Distribution'); }

  // Bar
  function updateBarChart(filteredData){ var container=document.getElementById('barChart'); d3.select('#barChart').select('svg').remove(); var width=container.clientWidth,height=300,margin={top:20,right:20,bottom:40,left:50}; var innerW=width-margin.left-margin.right,innerH=height-margin.top-margin.bottom; var svg=d3.select('#barChart').append('svg').attr('width','100%').attr('height',height).append('g').attr('transform','translate('+margin.left+','+margin.top+')'); var agg=allYears.map(function(y){ return {year:+y,count:filteredData.filter(function(d){return d.year===y;}).length }; }); var x=d3.scaleBand().domain(agg.map(function(d){return d.year;})).range([0,innerW]).padding(0.1); var y=d3.scaleLinear().domain([0,d3.max(agg,function(d){return d.count;})||1]).range([innerH,0]); svg.append('g').attr('transform','translate(0,'+innerH+')').call(d3.axisBottom(x).tickFormat(d3.format('d'))); svg.append('g').call(d3.axisLeft(y)); svg.selectAll('.bar').data(agg).enter().append('rect').attr('x',function(d){return x(d.year);}).attr('y',function(d){return y(d.count);}).attr('width',x.bandwidth()).attr('height',function(d){return innerH-y(d.count);}).attr('fill','#6c757d'); svg.append('text').attr('x',innerW/2).attr('y',innerH+margin.bottom-5).attr('text-anchor','middle').text('Year'); }

  // KPIs
  function updateKPICards(filteredData){ var total=filteredData.length; document.getElementById('totalCrashes').innerText=total; var fatal=filteredData.filter(function(d){return ((+d.FATAL_DRIVER||0)+(+d.FATAL_PEDESTRIAN||0)+(+d.FATAL_BICYCLIST||0))>0;}).length; document.getElementById('fatalCrashes').innerText=fatal; var major=filteredData.filter(function(d){return ((+d.MAJORINJURIES_DRIVER||0)+(+d.MAJORINJURIES_PEDESTRIAN||0)+(+d.MAJORINJURIES_BICYCLIST||0))>0;}).length; document.getElementById('majorInjuries').innerText=major; document.getElementById('percChange').innerText='N/A'; }

  // Controls
  [selectYear,selectWard,selectInjury,checkboxFatalities,checkboxPedestrians,checkboxBicyclists].forEach(function(el){ if(el) el.addEventListener('change',function(){ renderAll(); }); });
  // Marker-only: if the earlier UI contains toggle buttons they will still be present, but we ignore heatmap actions.
  if(helpBtn) helpBtn.addEventListener('click',function(){ var help='<div class="modal fade" id="helpModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Dashboard Help</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p>Use the controls to filter and toggle between Markers and Heat Map.</p></div></div></div></div>'; if(!document.getElementById('helpModal')) document.body.insertAdjacentHTML('beforeend',help); new bootstrap.Modal(document.getElementById('helpModal')).show(); });
  if(exportBtn) exportBtn.addEventListener('click',function(){ var ws=XLSX.utils.json_to_sheet(buildFilteredForMap()); var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Filtered'); XLSX.writeFile(wb,'filtered_crash_data.xlsx'); });

  if(typeof tippy!=='undefined') tippy('[data-tippy-content]',{placement:'bottom',animation:'scale',duration:200});

});
