(()=>{'use strict';
const $=id=>document.getElementById(id);
const DEFAULT={preset:'6x1',goalMinutes:480,weekdays:[false,true,true,true,true,true,true],weeklyGoals:[0,480,480,480,480,480,480],rotationStart:'',rotationGoal:720,hasInterval:true,breakMinutes:60};
const WEEK=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const FULL=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const LABELS4=['Entrada','Saída para intervalo','Retorno do intervalo','Saída'];
const LABELS2=['Entrada','Saída'];
let api=null,realApi=null,user=null,profile=null,marks=[],notes=[],busy=false,authMode='login',activeTab='ponto',modalDay=null,clockTimer=null,authReady=false,isDemo=false,calendarView=new Date(new Date().getFullYear(),new Date().getMonth(),1),calendarFocus=null;
let manualPhotoFile=null,manualPhotoObjectUrl=null,manualPhotoSourceLabel='';
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>dayKey(new Date());
function dayKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function parseDay(s){const p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);}
function validDay(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&dayKey(parseDay(s))===s;}
const timeOf=iso=>new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const hr=m=>`${Math.floor(Math.abs(Math.round(m))/60)}h ${String(Math.abs(Math.round(m))%60).padStart(2,'0')}min`;
const signed=m=>`${m<0?'−':'+'}${hr(m)}`;
const toTime=m=>`${String(Math.floor((Number(m)||0)/60)).padStart(2,'0')}:${String((Number(m)||0)%60).padStart(2,'0')}`;
function fromTime(s){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))return null;const [h,m]=s.split(':').map(Number);return h*60+m;}
function notify(message,error=false){const t=$('toast');t.textContent=message;t.style.background=error?'#a82740':'#172d63';t.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.hidden=true,4200);}
function authMessage(message,isError=false){const el=$('authMessage');el.hidden=false;el.classList.toggle('error',isError);el.textContent=message;}
function fail(error,fallback='Ocorreu um erro.'){console.error(error);notify((error&&error.message)||fallback,true);}
function dateLabel(s){return parseDay(s).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'});}
function normSettings(s={}){return {...DEFAULT,...(s||{}),weekdays:Array.isArray(s?.weekdays)&&s.weekdays.length===7?[...s.weekdays]:[...DEFAULT.weekdays],weeklyGoals:Array.isArray(s?.weeklyGoals)&&s.weeklyGoals.length===7?[...s.weeklyGoals]:[...DEFAULT.weeklyGoals],breakMinutes:s?.breakMinutes===undefined?60:Math.max(0,Math.min(720,Number(s.breakMinutes)||0))};}
function presetSettings(preset){const s=normSettings(DEFAULT);s.preset=preset;s.rotationStart=today();switch(preset){case '5x2':s.weekdays=[false,true,true,true,true,true,false];break;case '6x1':s.weekdays=[false,true,true,true,true,true,true];break;case 'parcial6':s.goalMinutes=360;s.weekdays=[false,true,true,true,true,true,true];break;case 'parcial4':s.goalMinutes=240;s.weekdays=[false,true,true,true,true,true,false];s.hasInterval=false;break;case '12x36':s.rotationGoal=720;break;case 'custom':s.weeklyGoals=[0,480,480,480,480,480,0];break;case 'livre':s.weekdays=[false,true,true,true,true,true,false];break;}return s;}
function scheduleForDay(d,s=profile?.schedule||DEFAULT){s=normSettings(s);const day=parseDay(d).getDay();let goal=0;if(s.preset==='custom')goal=Number(s.weeklyGoals[day])||0;else if(s.preset==='12x36'){
 const anchor=validDay(s.rotationStart)?parseDay(s.rotationStart):parseDay(today());const p=parseDay(d);const diff=Math.round((Date.UTC(p.getFullYear(),p.getMonth(),p.getDate())-Date.UTC(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()))/86400000);goal=(diff>=0&&diff%2===0)?Number(s.rotationGoal)||720:0;
}else goal=s.weekdays[day]?(Number(s.goalMinutes)||480):0;
return {scheduled:goal>0,goal_minutes:goal>0?goal:Number(s.preset==='12x36'?s.rotationGoal:s.goalMinutes)||480,has_interval:s.hasInterval!==false};}
const recordsOf=d=>marks.filter(m=>m.day===d).sort((a,b)=>a.mark_idx-b.mark_idx);
function dayPlan(d,arr=recordsOf(d)){if(arr.length)return {scheduled:arr[0].scheduled,goal_minutes:Number(arr[0].goal_minutes),has_interval:arr[0].has_interval};return scheduleForDay(d);}
const dayLabels=(d,arr=recordsOf(d))=>dayPlan(d,arr).has_interval?LABELS4:LABELS2;
function complete(d,arr=recordsOf(d)){const labels=dayLabels(d,arr);return arr.length===labels.length&&arr.every((m,i)=>m.mark_idx===i&&(i===0||new Date(m.at)>=new Date(arr[i-1].at)));}
const minutes=(start,end)=>Math.max(0,(new Date(end)-new Date(start))/60000);
function worked(d,arr=recordsOf(d)){if(!complete(d,arr))return 0;return arr.length===2?minutes(arr[0].at,arr[1].at):minutes(arr[0].at,arr[1].at)+minutes(arr[2].at,arr[3].at);}
function balance(d,arr=recordsOf(d)){if(!complete(d,arr))return null;const p=dayPlan(d,arr);return Math.round(worked(d,arr)-(p.scheduled?p.goal_minutes:0));}
// Calcula a previsão de saída apenas para dias iniciados e ainda incompletos.
// Antes do retorno, usa o intervalo configurado; após o retorno, usa o intervalo realmente registrado.
function predictedExit(d,arr=recordsOf(d)){
 if(!arr.length||complete(d,arr))return null;
 const plan=dayPlan(d,arr),goal=Number(plan.goal_minutes),first=new Date(arr[0].at);
 if(!plan.scheduled||!Number.isFinite(goal)||goal<=0||!Number.isFinite(first.getTime()))return null;
 let time=first.getTime()+goal*60000,note='Sem intervalo',estimated=false;
 if(plan.has_interval){
  const breakMin=normSettings(profile?.schedule).breakMinutes;
  if(arr.length>=3){
   const workedBeforeBreak=minutes(arr[0].at,arr[1].at);
   time=new Date(arr[2].at).getTime()+Math.max(0,goal-workedBeforeBreak)*60000;
   note='Calculada com o intervalo registrado';
  }else if(arr.length===2){
   const workedBeforeBreak=minutes(arr[0].at,arr[1].at);
   time=new Date(arr[1].at).getTime()+(breakMin+Math.max(0,goal-workedBeforeBreak))*60000;
   note=`Considerando ${hr(breakMin)} de intervalo previsto`;
   estimated=true;
  }else{
   time=first.getTime()+(goal+breakMin)*60000;
   note=`Considerando ${hr(breakMin)} de intervalo previsto`;
   estimated=true;
  }
 }
 if(!Number.isFinite(time))return null;
 return {at:new Date(time),note,estimated};
}
function groupDays(){return [...new Set(marks.map(r=>r.day))].sort().reverse();}
function bankStats(){let plus=0,minus=0,completed=0;for(const d of groupDays()){const b=balance(d);if(b===null)continue;completed++;if(b>=0)plus+=b;else minus-=b;}return {plus,minus,completed,total:plus-minus};}
function recordingDay(){const now=today(),prior=parseDay(now);prior.setDate(prior.getDate()-1);const yesterday=dayKey(prior);const a=recordsOf(yesterday);if(a.length&&!complete(yesterday,a)){const first=new Date(a[0].at);const hours=Date.now()-first.getTime();if(hours>=0&&hours<24*3600000&&(first.getHours()>=17||profile?.schedule?.preset==='12x36'))return yesterday;}return now;}
function clock(){const d=new Date();const two=n=>String(n).padStart(2,'0');$('clockMain').textContent=two(d.getHours())+':'+two(d.getMinutes());$('clockSeconds').textContent=':'+two(d.getSeconds());$('todayDate').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});if(user&&profile)updateRemaining();}
function setAuthMode(mode){authMode=mode;const signup=mode==='signup';$('nameField').hidden=!signup;$('authName').required=signup;$('authPassword').autocomplete=signup?'new-password':'current-password';$('authTitle').textContent=signup?'Crie sua conta grátis':'Bem-vindo de volta';$('authSubtitle').textContent=signup?'Seus pontos ficam disponíveis quando você entrar.':'Entre para ver seus registros.';$('authSubmit').textContent=signup?'Criar minha conta':'Entrar na minha conta';$('forgotPassword').hidden=signup;['modeLogin','modeSignup'].forEach((id,i)=>{const sel=(i===1)===signup;$(id).classList.toggle('selected',sel);$(id).setAttribute('aria-selected',String(sel));});$('authMessage').hidden=true;}
function setBusy(value){busy=value;for(const id of ['registerNow','photoRegister','openManual','authSubmit','saveSettings'])$(id).disabled=value;}
async function onAuthSubmit(e){e.preventDefault();if(!api||busy)return;const email=$('authEmail').value.trim().toLowerCase(),password=$('authPassword').value,name=$('authName').value.trim();if(authMode==='signup'&&name.length<2){authMessage('Informe seu nome.',true);return;}setBusy(true);$('authMessage').hidden=true;try{
 let data,error;if(authMode==='signup')({data,error}=await api.auth.signUp({email,password,options:{data:{name}}}));else ({data,error}=await api.auth.signInWithPassword({email,password}));if(error)throw error;
 if(authMode==='signup'&&!data.session){authMessage('Conta solicitada! Confira seu e-mail e confirme o cadastro antes de entrar.');setAuthMode('login');authMessage('Conta solicitada! Confira seu e-mail e confirme o cadastro antes de entrar.');}
 else if(data.session){await enter(data.session.user);notify(authMode==='signup'?'Conta criada com sucesso!':'Bem-vindo ao Jornada+!');}
}catch(err){authMessage(err.message||'Falha no acesso. Confira seu e-mail e senha.',true);}finally{setBusy(false);}}
async function forgot(){if(!api)return;const email=$('authEmail').value.trim();if(!email){authMessage('Digite seu e-mail no campo acima.',true);return;}try{const {error}=await api.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;authMessage('Se esse e-mail estiver cadastrado, você receberá as instruções para recuperar sua senha.');}catch(e){authMessage(e.message,true);}}
async function resetPassword(){if(!api)return;const email=user?.email||$('authEmail').value.trim();if(!email){notify('Não foi possível identificar o e-mail.',true);return;}try{const {error}=await api.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;notify('Verifique o e-mail para redefinir sua senha.');}catch(e){fail(e);}}
async function changePassword(){const pwd=prompt('Digite uma nova senha (mínimo 6 caracteres):');if(pwd===null)return;if(pwd.length<6){notify('Senha muito curta.',true);return;}const confirmPwd=prompt('Repita a nova senha:');if(pwd!==confirmPwd){notify('As senhas não coincidem.',true);return;}const {error}=await api.auth.updateUser({password:pwd});if(error)fail(error);else notify('Senha alterada.');}
async function ensureProfile(){const {data,error}=await api.from('jornada_profiles').select('*').eq('id',user.id).maybeSingle();if(error)throw error;if(data)return data;const newProfile={id:user.id,name:user.user_metadata?.name||user.email?.split('@')[0]||'Meu perfil',schedule:presetSettings('6x1')};const ret=await api.from('jornada_profiles').upsert(newProfile,{onConflict:'id'}).select('*').single();if(ret.error)throw ret.error;return ret.data;}
async function enter(u){if(!u)return;if(user?.id===u.id&&profile&&authReady)return;user=u;authReady=false;try{profile=await ensureProfile();await loadMarks();await loadNotes();$('authScreen').hidden=true;$('appScreen').hidden=false;$('navBar').hidden=false;$('accountSummary').hidden=false;authReady=true;render();selectTab('ponto');}catch(e){console.error(e);user=null;profile=null;marks=[];$('authScreen').hidden=false;$('appScreen').hidden=true;$('navBar').hidden=true;$('accountSummary').hidden=true;authMessage('Não foi possível carregar a conta. Confira se o setup.sql foi executado no Supabase. Detalhes: '+e.message,true);}}
async function loadMarks(){const {data,error}=await api.from('jornada_marks').select('*').eq('user_id',user.id).order('day',{ascending:false}).order('mark_idx',{ascending:true}).limit(5000);if(error)throw error;marks=data||[];}
async function loadNotes(){const {data,error}=await api.from('jornada_notes').select('*').eq('user_id',user.id).limit(5000);if(error)throw error;notes=data||[];}
async function refresh(){await loadMarks();await loadNotes();render();}
async function signOut(){if(isDemo){isDemo=false;api=realApi;exit();return;}if(!api)return;const {error}=await api.auth.signOut();if(error){fail(error);return;}exit();}
function exit(){user=null;profile=null;marks=[];notes=[];authReady=false;$('demoBadge').hidden=true;$('appScreen').hidden=true;$('navBar').hidden=true;$('accountSummary').hidden=true;$('authScreen').hidden=false;setAuthMode('login');}
function render(){if(!user||!profile)return;clock();const name=profile.name||'Meu perfil';$('userMiniName').textContent=name.split(' ')[0];$('welcomeName').textContent=`Olá, ${name.split(' ')[0]}! Registre seu horário de forma simples.`;$('profileName').value=name;$('profileEmail').textContent=isDemo?'Demonstração local — não é uma conta online':user.email;$('demoBadge').hidden=!isDemo;$('demoTools').hidden=!isDemo;$('requestReset').disabled=isDemo;
 const d=recordingDay(),arr=recordsOf(d),labels=dayLabels(d,arr),plan=dayPlan(d,arr);$('schedulePill').textContent=plan.scheduled?`Meta ${hr(plan.goal_minutes)}`:'Folga';$('nextLabel').textContent=arr.length<labels.length?labels[arr.length]:'Jornada concluída';$('nextDescription').textContent=arr.length<labels.length?(d===today()?'Registre o horário atual ou informe manualmente.':'Continuação de jornada iniciada ontem.'):'Todas as marcações desse dia foram realizadas.';$('registerNow').disabled=busy||arr.length>=labels.length;$('photoRegister').disabled=busy||arr.length>=labels.length;
 $('dayState').textContent=complete(d,arr)?'Concluído':arr.length?'Em andamento':'Sem registros';
 const forecast=predictedExit(d,arr),forecastDate=forecast?.at;
 $('exitForecast').hidden=!forecast;
 if(forecast){$('exitForecastValue').textContent=timeOf(forecastDate.toISOString())+(dayKey(forecastDate)!==d?' (+1 dia)':'');$('exitForecastNote').textContent=forecast.note+'.';updateRemaining();}
 $('todayMarks').innerHTML=labels.map((label,i)=>{const m=arr[i];return `<div class="mark-row"><div class="step-circle ${m?'done':''}">${m?'✓':'◷'}</div><div class="mark-main"><div class="mark-title">${label}</div><div class="mark-desc">${m?(m.manual?'Manual':'Automático')+(m.photo_path?(m.manual?' · Com imagem':' · Com foto'):'')+(m.original_at?' · Corrigido':''):'Aguardando'}</div></div>${m?`<div class="mark-time">${timeOf(m.at)}${dayKey(new Date(m.at))!==d?' +1d':''}</div>${m.photo_path?`<button class="thumb-button" type="button" data-photo="${escapeHtml(m.id)}">Foto</button>`:''}`:(forecast&&i===labels.length-1?`<div class="mark-forecast"><strong>${timeOf(forecastDate.toISOString())}</strong><span>Prevista${dayKey(forecastDate)!==d?' · +1 dia':''}</span></div>`:'<div class="small-label">—</div>')}</div>`;}).join('');
 const s=bankStats();for(const id of ['homeBalance','totalBalance']){const el=$(id);el.textContent=signed(s.total);el.classList.toggle('minus',s.total<0);}$('positiveTotal').textContent=hr(s.plus);$('negativeTotal').textContent=hr(s.minus);$('completedCount').textContent=`${s.completed} ${s.completed===1?'dia concluído':'dias concluídos'}`;$('dailyTarget').textContent=profile.schedule?.preset==='custom'?'Meta por dia':`Jornada ${profile.schedule?.preset||'6x1'}`;
 const days=groupDays();$('bankDays').innerHTML=days.length?days.map(d=>dayCard(d,true)).join(''):'<div class="card empty">Nenhum registro ainda. Use a aba Ponto para começar.</div>';
 $('historyDays').innerHTML=days.length?days.map(d=>dayCard(d,false)).join(''):'<div class="card empty">Seu histórico aparecerá aqui assim que registrar o primeiro ponto.</div>';
 fillSettings();renderCalendar();renderBankChart();renderReports();renderCorrections();}
function dayCard(d,isBank){const a=recordsOf(d),b=balance(d,a),p=dayPlan(d,a),summary=b===null?'Incompleto':signed(b);return `<section class="card day-card"><div><div class="title">${dateLabel(d)}</div><p>${b===null?'Marcação incompleta':`${hr(worked(d,a))} trabalhadas · ${p.scheduled?'Trabalho':'Folga'}`}${a.some(m=>m.photo_path)?' · Com imagem':''}${notes.some(n=>n.day===d)?' · Com observação':''}</p><button type="button" data-edit="${d}">Ver / corrigir horários</button></div><b class="diff ${b===null?'':b<0?'minus':'plus'}">${summary}</b></section>`;}
function selectTab(name){if(!['ponto','banco','calendario','historico','relatorios','perfil'].includes(name))return;activeTab=name;for(const n of ['ponto','banco','calendario','historico','relatorios','perfil'])$('panel-'+n).hidden=name!==n;document.querySelectorAll('[data-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===name));window.scrollTo(0,0);}
async function addMark({date,at,manual=false,photo=null}){if(!user)throw new Error('Entre na sua conta antes de registrar.');const arr=recordsOf(date),labels=dayLabels(date,arr);if(arr.length>=labels.length)throw new Error('Todas as marcações deste dia já foram realizadas.');if(!validDay(date))throw new Error('Data inválida.');if(arr.length&&new Date(at)<new Date(arr.at(-1).at))throw new Error('O horário não pode ser anterior à marcação anterior.');if(arr.length&&new Date(at)-new Date(arr[0].at)>36*3600000)throw new Error('A jornada não pode ultrapassar 36 horas.');
 const plan=dayPlan(date,arr);const record={user_id:user.id,day:date,mark_idx:arr.length,at:new Date(at).toISOString(),manual,scheduled:plan.scheduled,goal_minutes:plan.goal_minutes,has_interval:plan.has_interval};let uploadedPath=null;
 try{if(photo){if(photo.size>15*1024*1024)throw new Error('Foto muito grande. Selecione uma imagem de até 15 MB.');const jpeg=await normalizePhoto(photo);uploadedPath=`${user.id}/${self.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2)}.jpg`;const upload=await api.storage.from('ponto-fotos').upload(uploadedPath,jpeg,{contentType:'image/jpeg',upsert:false});if(upload.error)throw upload.error;record.photo_path=uploadedPath;}
 const {error}=await api.from('jornada_marks').insert(record);if(error)throw error;await refresh();notify(manual?'Horário manual salvo!':'Ponto registrado com sucesso!');
 }catch(e){if(uploadedPath)await api.storage.from('ponto-fotos').remove([uploadedPath]).catch(()=>{});throw e;}}
function normalizePhoto(file){return new Promise((resolve,reject)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{try{const canvas=document.createElement('canvas'),max=1024,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao converter foto.')),'image/jpeg',.76);}catch(e){reject(e);}finally{URL.revokeObjectURL(url);}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não foi possível abrir a foto.'));};img.src=url;});}
async function automatic(photo=null){if(busy)return;setBusy(true);try{const date=recordingDay();await addMark({date,at:new Date(),photo});}catch(e){fail(e);}finally{setBusy(false);render();}}
function showModal(id){$(id).hidden=false;}
function hideModal(id){$(id).hidden=true;if(id==='manualModal')clearManualPhoto();}
function clearManualPhoto(){
 manualPhotoFile=null;manualPhotoSourceLabel='';
 if(manualPhotoObjectUrl){URL.revokeObjectURL(manualPhotoObjectUrl);manualPhotoObjectUrl=null;}
 $('manualCameraInput').value='';$('manualGalleryInput').value='';
 $('manualPreviewImage').removeAttribute('src');$('manualPhotoPreview').hidden=true;
 $('manualPhotoHelp').textContent='Você pode registrar o horário sem anexar uma imagem.';
}
function chooseManualPhoto(file,source){
 if(!file)return;
 if(!file.type.startsWith('image/'))return notify('Escolha um arquivo de imagem.',true);
 if(file.size>15*1024*1024)return notify('A imagem deve ter no máximo 15 MB.',true);
 if(file.size===0)return notify('A imagem está vazia. Selecione outra.',true);
 if(manualPhotoObjectUrl)URL.revokeObjectURL(manualPhotoObjectUrl);
 manualPhotoFile=file;manualPhotoSourceLabel=source;
 manualPhotoObjectUrl=URL.createObjectURL(file);
 $('manualPreviewImage').src=manualPhotoObjectUrl;
 $('manualPhotoName').textContent=file.name||'Imagem selecionada';
 $('manualPhotoSource').textContent=source+' · '+Math.max(1,Math.round(file.size/1024))+' KB';
 $('manualPhotoPreview').hidden=false;
 $('manualPhotoHelp').textContent='Imagem anexada. Ela será salva junto com esta marcação.';
}
function openManual(){clearManualPhoto();const d=recordingDay();$('manualDate').value=d;$('manualTime').value=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});$('manualNextDay').checked=false;updateManual();showModal('manualModal');}
function updateManual(){const d=$('manualDate').value;const a=validDay(d)?recordsOf(d):[];const labels=validDay(d)?dayLabels(d,a):LABELS4;$('manualStep').value=a.length<labels.length?labels[a.length]:'Jornada já concluída';}
async function submitManual(e){e.preventDefault();const date=$('manualDate').value,t=$('manualTime').value;if(!validDay(date)||fromTime(t)===null)return notify('Informe data e hora válidas.',true);if(recordsOf(date).length>=dayLabels(date).length)return notify('Dia já concluído. Corrija pelo Histórico.',true);const d=parseDay(date);if($('manualNextDay').checked)d.setDate(d.getDate()+1);const [h,m]=t.split(':').map(Number);d.setHours(h,m,0,0);setBusy(true);try{await addMark({date,at:d,manual:true,photo:manualPhotoFile});hideModal('manualModal');}catch(e){fail(e);}finally{setBusy(false);render();}}
async function showPicture(id){const m=marks.find(p=>p.id===id);if(!m?.photo_path)return;try{const {data,error}=await api.storage.from('ponto-fotos').createSignedUrl(m.photo_path,60);if(error)throw error;$('pictureView').src=data.signedUrl;$('pictureLabel').textContent=dateLabel(m.day)+' · '+timeOf(m.at);showModal('pictureModal');}catch(e){fail(e);}}
function openDay(d){const a=recordsOf(d);if(!a.length)return;modalDay=d;const n=notes.find(n=>n.day===d);$('noteType').value=n?.kind||'';$('noteText').value=n?.description||'';$('dayModalTitle').textContent='Corrigir '+dateLabel(d);const p=dayPlan(d,a);$('editScheduled').checked=p.scheduled;$('editGoal').value=toTime(p.goal_minutes);$('editRows').innerHTML=a.map((m,i)=>{const stamp=new Date(m.at);const nextDay=dayKey(stamp)!==d;return `<div class="edit-row"><label class="field"><span>${dayLabels(d,a)[i]}${m.photo_path?' · Imagem anexada':''}</span><input class="edit-time" type="time" data-i="${i}" value="${timeOf(m.at)}" required></label><label class="inline-check"><input class="edit-next" data-i="${i}" type="checkbox" ${nextDay?'checked':''}> Ocorreu no dia seguinte</label>${m.photo_path?`<button type="button" class="simple-link" data-photo="${escapeHtml(m.id)}">Ver foto</button>`:''}</div>`;}).join('');showModal('dayModal');}
async function saveDay(e){e.preventDefault();if(!modalDay||busy)return;const a=recordsOf(modalDay),p=dayPlan(modalDay,a),scheduled=$('editScheduled').checked,goal=fromTime($('editGoal').value);if(goal===null||goal===0&&scheduled)return notify('Informe uma meta válida.',true);const times=[...$('editRows').querySelectorAll('.edit-time')],updates=[];let last=0;
 for(let i=0;i<a.length;i++){const t=times[i].value,minutes=fromTime(t);if(minutes===null)return notify('Preencha todos os horários.',true);const date=parseDay(modalDay);if($('editRows').querySelector(`.edit-next[data-i="${i}"]`).checked)date.setDate(date.getDate()+1);date.setMinutes(minutes,0,0);const epoch=date.getTime();if(i&&epoch<last)return notify('Os horários devem estar em ordem.',true);last=epoch;const rec=a[i];updates.push({id:rec.id,user_id:user.id,day:modalDay,mark_idx:rec.mark_idx,at:date.toISOString(),manual:true,original_at:rec.original_at||(rec.at!==date.toISOString()?rec.at:null),scheduled,goal_minutes:goal,has_interval:p.has_interval,photo_path:rec.photo_path});}
 if(updates.length>1&&new Date(updates.at(-1).at)-new Date(updates[0].at)>36*3600000)return notify('Jornada superior a 36 horas.',true);
 setBusy(true);try{const {error}=await api.from('jornada_marks').upsert(updates,{onConflict:'id'});if(error)throw error;await refresh();hideModal('dayModal');notify('Horários corrigidos e banco recalculado.');}catch(e){fail(e);}finally{setBusy(false);}}
async function deleteDay(){if(!modalDay||busy)return;if(!confirm(`Excluir todas as marcações de ${dateLabel(modalDay)}? Esta ação não pode ser desfeita.`))return;const a=recordsOf(modalDay);setBusy(true);try{const {error}=await api.from('jornada_marks').delete().eq('user_id',user.id).eq('day',modalDay);if(error)throw error;const paths=a.filter(x=>x.photo_path).map(x=>x.photo_path);if(paths.length){const res=await api.storage.from('ponto-fotos').remove(paths);if(res.error)console.warn('Fotos não removidas:',res.error);}await refresh();hideModal('dayModal');notify('Dia excluído.');}catch(e){fail(e);}finally{setBusy(false);}}
function scheduleFormVisibility(){const preset=$('schedulePreset').value;$('weeklySchedule').hidden=['12x36','custom'].includes(preset);$('customSchedule').hidden=preset!=='custom';$('rotatingSchedule').hidden=preset!=='12x36';$('intervalEstimateField').hidden=!$('hasInterval').checked;}
function fillSettings(){const s=normSettings(profile.schedule);$('schedulePreset').value=s.preset;$('scheduleGoal').value=toTime(s.goalMinutes);$('rotationStart').value=s.rotationStart||today();$('rotationGoal').value=toTime(s.rotationGoal);$('hasInterval').checked=s.hasInterval!==false;$('breakGoal').value=toTime(s.breakMinutes);
 $('weekdays').innerHTML=WEEK.map((day,i)=>`<label>${day}<input data-day="${i}" type="checkbox" ${s.weekdays[i]?'checked':''}></label>`).join('');$('customDays').innerHTML=FULL.map((day,i)=>`<label>${day}<input data-day="${i}" type="time" value="${toTime(s.weeklyGoals[i])}"></label>`).join('');scheduleFormVisibility();}
function applyPreset(){const preset=$('schedulePreset').value;const s=presetSettings(preset);$('scheduleGoal').value=toTime(s.goalMinutes);$('rotationStart').value=s.rotationStart;$('rotationGoal').value=toTime(s.rotationGoal);$('hasInterval').checked=s.hasInterval;$('breakGoal').value=toTime(s.breakMinutes);$('weekdays').innerHTML=WEEK.map((day,i)=>`<label>${day}<input data-day="${i}" type="checkbox" ${s.weekdays[i]?'checked':''}></label>`).join('');$('customDays').innerHTML=FULL.map((day,i)=>`<label>${day}<input data-day="${i}" type="time" value="${toTime(s.weeklyGoals[i])}"></label>`).join('');scheduleFormVisibility();}
async function saveSettings(){if(!user||busy)return;const preset=$('schedulePreset').value,name=$('profileName').value.trim(),s=normSettings(profile.schedule);if(name.length<2)return notify('Informe um nome.',true);s.preset=preset;s.hasInterval=$('hasInterval').checked;s.breakMinutes=fromTime($('breakGoal').value);if(s.breakMinutes===null)return notify('Informe um intervalo previsto válido.',true);if(preset==='12x36'){s.rotationStart=$('rotationStart').value;s.rotationGoal=fromTime($('rotationGoal').value);if(!validDay(s.rotationStart)||!s.rotationGoal)return notify('Preencha a data e meta do plantão.',true);}else if(preset==='custom'){s.weeklyGoals=[...$('customDays').querySelectorAll('input')].map(x=>fromTime(x.value));if(s.weeklyGoals.length!==7||s.weeklyGoals.some(n=>n===null))return notify('Preencha as metas da semana.',true);}else{s.goalMinutes=fromTime($('scheduleGoal').value);s.weekdays=[...$('weekdays').querySelectorAll('input')].map(x=>x.checked);if(!s.goalMinutes||s.weekdays.length!==7)return notify('Informe a meta e os dias de trabalho.',true);}
 setBusy(true);try{const {data,error}=await api.from('jornada_profiles').update({name,schedule:s}).eq('id',user.id).select('*').single();if(error)throw error;profile=data;render();notify('Jornada salva com sucesso!');}catch(e){fail(e);}finally{setBusy(false);}}
function b64Blob(base64){const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<bytes.length;i++)bytes[i]=raw.charCodeAt(i);return new Blob([bytes],{type:'image/jpeg'});}
async function importLegacy(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;if(marks.length){notify('Importação permitida somente em uma conta sem registros.',true);return;}if(file.size>60*1024*1024){notify('Backup acima de 60 MB não é suportado.',true);return;}
 setBusy(true);try{const data=JSON.parse(await file.text());if(data.app!=='Jornada+ pessoal'||![2,3,4].includes(data.version)||!Array.isArray(data.records))throw new Error('Não é um backup do Jornada+.');let selected='principal',s=normSettings(data.settings||DEFAULT),name=profile.name;
 if(data.version===4&&Array.isArray(data.profiles)){const choices=data.profiles.map((p,i)=>`${i+1}. ${p.name}`).join('\n'),index=data.profiles.length===1?1:Number(prompt('Qual pessoa deseja importar para ESTA conta?\n'+choices,'1'));if(!Number.isInteger(index)||index<1||index>data.profiles.length)throw new Error('Seleção cancelada ou inválida.');const p=data.profiles[index-1];selected=p.id;s=normSettings(p.settings);name=p.name;}
 const list=data.records.filter(x=>(x.profileId||'principal')===selected);if(list.length>1000)throw new Error('O backup excede 1.000 registros para importação.');if(!list.length)throw new Error('Essa pessoa não tem registros no backup.');if(!confirm(`Importar ${list.length} marcações de ${name} para a conta ${user.email}?`))return;
 const upd=await api.from('jornada_profiles').update({name,schedule:s}).eq('id',user.id);if(upd.error)throw upd.error;profile={...profile,name,schedule:s};let imported=0;
 for(const m of list){if(!validDay(m.day)||!Number.isInteger(m.order)||m.order<0||m.order>3||Number.isNaN(Date.parse(m.at)))continue;let photo_path=null;
 if(m.photo){const blob=b64Blob(m.photo),jpeg=await normalizePhoto(blob);photo_path=`${user.id}/${self.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)}.jpg`;const up=await api.storage.from('ponto-fotos').upload(photo_path,jpeg,{contentType:'image/jpeg'});if(up.error)throw up.error;}
 const plan=m.scheduled===undefined?scheduleForDay(m.day,s):{scheduled:m.scheduled,goal_minutes:m.goalMinutes||s.goalMinutes||480,has_interval:m.hasInterval!==false};
 const row={user_id:user.id,day:m.day,mark_idx:m.order,at:m.at,manual:!!m.manual,scheduled:!!plan.scheduled,goal_minutes:Number(plan.goal_minutes)||480,has_interval:!!plan.has_interval,photo_path,original_at:m.originalAt||null};const {error}=await api.from('jornada_marks').upsert(row,{onConflict:'user_id,day,mark_idx'});if(error)throw error;imported++;
 }await refresh();notify(`Importados ${imported} registros para sua conta.`);
 }catch(e){fail(e,'Falha ao importar backup. Alguns registros podem ter sido importados.');await refresh().catch(()=>{});}finally{setBusy(false);}}

// CALENDÁRIO E RELATÓRIOS
const NOTE_LABELS={falta:'Falta',atestado:'Atestado',feriado:'Feriado',folga:'Folga',outro:'Outro'};
function noteFor(d){return notes.find(n=>n.day===d);}
function shiftMonth(n){calendarView=new Date(calendarView.getFullYear(),calendarView.getMonth()+n,1);renderCalendar();renderReports();renderBankChart();}
function monthKeys(){const year=calendarView.getFullYear(),m=calendarView.getMonth();return Array.from({length:new Date(year,m+1,0).getDate()},(_,i)=>dayKey(new Date(year,m,i+1)));}
function monthStats(){let workedMin=0,saldo=0,completed=0,missing=0;for(const d of monthKeys()){const arr=recordsOf(d),b=balance(d,arr);if(b!==null){workedMin+=worked(d,arr);saldo+=b;completed++;}else if(arr.length)missing++;}return {workedMin,saldo,completed,missing};}
function renderCalendar(){if(!profile)return;const y=calendarView.getFullYear(),m=calendarView.getMonth(),month=calendarView.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});$('calendarMonth').textContent=month.charAt(0).toUpperCase()+month.slice(1);const offset=new Date(y,m,1).getDay(),count=new Date(y,m+1,0).getDate();let html='';for(let i=0;i<offset;i++)html+='<div></div>';for(let n=1;n<=count;n++){const d=dayKey(new Date(y,m,n)),arr=recordsOf(d),b=balance(d,arr),note=noteFor(d);const status=b===null?(arr.length?'status-pending':note?'status-note':''):(b>0?'status-plus':b<0?'status-minus':'status-neutral');const name=b!==null?`Saldo ${signed(b)}`:arr.length?'Marcações incompletas':note?`Observação: ${NOTE_LABELS[note.kind]||'Outro'}`:'Sem registro';html+=`<button class="calendar-date ${status} ${d===today()?'today':''}" data-calendar-day="${d}" type="button" aria-label="${n} de ${month}, ${escapeHtml(name)}"><span class="day-num">${n}</span><span class="day-dot"></span></button>`;}$('calendarGrid').innerHTML=html;const st=monthStats();$('monthWorked').textContent=hr(st.workedMin);$('monthBalance').textContent=signed(st.saldo);$('monthBalance').className=st.saldo<0?'negative':'positive';$('monthSummary').textContent=`${st.completed} dia(s) concluído(s) · ${st.missing} dia(s) com marcações incompletas. Dias sem registro não são debitados automaticamente.`;}
function openCalendarDay(d){if(!validDay(d))return;calendarFocus=d;const a=recordsOf(d),b=balance(d,a),p=dayPlan(d,a),note=noteFor(d);$('calendarDayTitle').textContent=parseDay(d).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});let html=`<div class="detail-line"><span>Situação</span><strong>${a.length?(b===null?'Incompleto':'Concluído'):'Sem registros'}</strong></div><div class="detail-line"><span>Jornada prevista</span><strong>${p.scheduled?hr(p.goal_minutes):'Folga'}</strong></div>`;for(let i=0;i<a.length;i++)html+=`<div class="detail-line"><span>${escapeHtml(dayLabels(d,a)[i])}</span><strong>${timeOf(a[i].at)} ${a[i].manual?'(manual)':''}${a[i].photo_path?' · imagem':''}</strong></div>`;if(b!==null){html+=`<div class="detail-line"><span>Horas trabalhadas</span><strong>${hr(worked(d,a))}</strong></div><div class="detail-line"><span>Saldo</span><strong>${signed(b)}</strong></div>`;}if(note)html+=`<p class="note-text"><b>${escapeHtml(NOTE_LABELS[note.kind]||'Observação')}</b>${note.description?' — '+escapeHtml(note.description):''}</p>`;$('calendarDayContent').innerHTML=html;$('calendarDayAction').textContent=a.length?'Ver / corrigir horários':'Registrar horário manualmente';showModal('calendarDayModal');}
function calendarAction(){const d=calendarFocus;if(!d)return;hideModal('calendarDayModal');if(recordsOf(d).length){openDay(d);}else{openManual();$('manualDate').value=d;updateManual();}}
async function saveNote(){if(!modalDay||busy)return;const kind=$('noteType').value,description=$('noteText').value.trim();setBusy(true);try{let res;if(!kind&&!description){res=await api.from('jornada_notes').delete().eq('user_id',user.id).eq('day',modalDay);}else{res=await api.from('jornada_notes').upsert({user_id:user.id,day:modalDay,kind:kind||'outro',description},{onConflict:'user_id,day'});}if(res.error)throw res.error;await refresh();notify('Observação salva. Não altera o saldo automaticamente.');}catch(e){fail(e);}finally{setBusy(false);}}
function csvEscape(value){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return /[",;\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function monthRows(){return monthKeys().filter(d=>recordsOf(d).length||noteFor(d)).map(d=>{const a=recordsOf(d),b=balance(d,a),p=dayPlan(d,a),note=noteFor(d);return [d,p.scheduled?'Trabalho':'Folga',p.scheduled?hr(p.goal_minutes):'0h 00min',...Array.from({length:4},(_,i)=>{const mark=p.has_interval?a[i]:i===0?a[0]:i===3?a[1]:null;return mark?timeOf(mark.at):'';}),b===null?'':hr(worked(d,a)),b===null?'Incompleto':signed(b),note?NOTE_LABELS[note.kind]||'Outro':'',note?.description||''];});}
const CSV_HEADERS=['Data','Tipo de dia','Meta','Entrada','Intervalo','Retorno','Saída','Horas trabalhadas','Saldo','Situação','Observações'];
function downloadText(text,name,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),800);}
function exportCsv(){const rows=monthRows(),line=a=>a.map(csvEscape).join(';');downloadText('\ufeff'+[CSV_HEADERS,...rows].map(line).join('\r\n'),`Jornada_Mes_${dayKey(calendarView).slice(0,7)}.csv`,'text/csv;charset=utf-8');notify('Relatório CSV gerado.');}
function printMonth(){const r=monthRows(),month=calendarView.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}),stats=monthStats();$('printReport').innerHTML=`<h1>Jornada+ · Relatório mensal</h1><p>Usuário: ${escapeHtml(profile.name)} · ${escapeHtml(month)}</p><div class="print-summary"><b>Total trabalhado:</b> ${hr(stats.workedMin)} &nbsp; <b>Saldo do mês:</b> ${signed(stats.saldo)}</div><table><thead><tr>${CSV_HEADERS.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${r.map(row=>`<tr>${row.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Controle pessoal, não é documento oficial de ponto.</p>`;window.print();}

// MODO DEMONSTRAÇÃO: dados só neste navegador, nunca cria credenciais reais.
const DEMO_KEY='jornada_v4_demonstracao';
const demoUser={id:'demo-user',email:'demo@jornada.local',user_metadata:{name:'Usuário Teste'}};
function demoInitial(){return {profiles:[{id:'demo-user',name:'Usuário Teste',schedule:presetSettings('6x1')}],marks:[],notes:[],photos:{}};}
function demoRead(){try{const x=JSON.parse(localStorage.getItem(DEMO_KEY)||'null');return x&&Array.isArray(x.profiles)&&Array.isArray(x.marks)&&Array.isArray(x.notes)?x:demoInitial();}catch(e){return demoInitial();}}
function demoSave(state){localStorage.setItem(DEMO_KEY,JSON.stringify(state));}
function demoId(){return self.crypto?.randomUUID?.()||('demo-'+Date.now()+'-'+Math.random().toString(36).slice(2));}
function demoTable(table){const tableName=({jornada_profiles:'profiles',jornada_marks:'marks',jornada_notes:'notes'})[table];if(!tableName)throw new Error('Tabela inválida.');const q={op:'select',value:null,filters:[],sort:[],limitValue:Infinity,selectAfter:false,onConflict:'id'};
function match(row){return q.filters.every(([key,value])=>String(row[key])===String(value));}
function execute(){try{let db=demoRead(),collection=db[tableName],rows=collection.filter(match);if(q.op==='select'){for(const [key,asc] of [...q.sort].reverse())rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]))*(asc?1:-1));rows=rows.slice(0,q.limitValue);}else if(q.op==='insert'){const incoming=Array.isArray(q.value)?q.value:[q.value];rows=[];for(const value of incoming){const rec={...value,id:value.id||demoId()};if(tableName==='marks'&&collection.some(x=>x.user_id===rec.user_id&&x.day===rec.day&&x.mark_idx===rec.mark_idx))throw new Error('Esse horário já foi registrado.');collection.push(rec);rows.push(rec);}}else if(q.op==='upsert'){const incoming=Array.isArray(q.value)?q.value:[q.value],keys=q.onConflict.split(',');rows=[];for(const value of incoming){let found=collection.find(rec=>keys.every(k=>rec[k]===value[k]));if(found)Object.assign(found,value);else{found={id:value.id||demoId(),...value};collection.push(found);}rows.push({...found});}}else if(q.op==='update'){rows.forEach(r=>Object.assign(r,q.value));}else if(q.op==='delete'){db[tableName]=collection.filter(r=>!match(r));}if(q.op!=='select')demoSave(db);const result=q.mode==='single'?rows.length===1?rows[0]:null:q.mode==='maybeSingle'?rows[0]||null:rows;return {data:result,error:q.mode==='single'&&!result?{message:'Registro não encontrado.'}:null};}catch(e){return {data:null,error:{message:e.message}};}}
const o={select(){if(q.op!=='select')q.selectAfter=true;return o;},insert(v){q.op='insert';q.value=v;return o;},upsert(v,opts={}){q.op='upsert';q.value=v;q.onConflict=opts.onConflict||'id';return o;},update(v){q.op='update';q.value=v;return o;},delete(){q.op='delete';return o;},eq(k,v){q.filters.push([k,v]);return o;},order(k,opt={}){q.sort.push([k,opt.ascending!==false]);return o;},limit(n){q.limitValue=n;return o;},single(){q.mode='single';return Promise.resolve(execute());},maybeSingle(){q.mode='maybeSingle';return Promise.resolve(execute());},then(success,error){return Promise.resolve(execute()).then(success,error);}};return o;}
function readDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível salvar a foto.'));reader.readAsDataURL(blob);});}
function demoStorage(){return {from(){return {async upload(path,blob){try{const db=demoRead();db.photos[path]=await readDataUrl(blob);demoSave(db);return {data:{path},error:null};}catch(e){return {data:null,error:{message:'Espaço do navegador insuficiente para esta foto.'}};}},async remove(paths){const db=demoRead();for(const path of paths)delete db.photos[path];demoSave(db);return {error:null};},async createSignedUrl(path){const url=demoRead().photos[path];return {data:url?{signedUrl:url}:null,error:url?null:{message:'Foto não encontrada.'}};}};}};}
function makeDemoApi(){return {from:demoTable,storage:demoStorage(),auth:{async signOut(){return {error:null};}}};}
async function clearDemo(){if(!isDemo||!confirm('Apagar TODOS os dados desta demonstração neste navegador?'))return;localStorage.removeItem(DEMO_KEY);profile=await ensureProfile();await refresh();notify('Demonstração reiniciada.');}
async function enterDemo(){if(user&&!isDemo)return;isDemo=true;api=makeDemoApi();$('authMessage').hidden=true;await enter(demoUser);if(user)notify('Demonstração local ativada. Seus dados de teste não são uma conta online.');}


// Jornada+ V5 — relatórios, gráficos, correções e interface instalável.
function updateRemaining(){
 const out=$('timeRemaining');if(!out||!user||!profile)return;
 const d=recordingDay(),pred=predictedExit(d);if(!pred){out.textContent='';return;}
 const remaining=Math.ceil((pred.at.getTime()-Date.now())/60000);
 out.textContent=remaining>0?`${hr(remaining)} restantes`:remaining===0?'Horário previsto agora':`${hr(-remaining)} após o previsto`;
}
function renderBankChart(){
 const el=$('bankChart');if(!el)return;
 const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-41);
 start.setHours(0,0,0,0);
 const weeks=Array.from({length:6},(_,i)=>({label:`Sem ${i+1}`,sum:0}));let count=0;
 for(const d of groupDays()){
  const dt=parseDay(d),b=balance(d);if(b===null||dt<start||dt>now)continue;
  const offset=Math.floor((dt-start)/86400000),i=Math.min(5,Math.max(0,Math.floor(offset/7)));
  weeks[i].sum+=b;count++;
 }
 if(!count){el.innerHTML='<div class="chart-empty">O gráfico aparecerá após você concluir seu primeiro dia.</div>';return;}
 let sum=0;const values=weeks.map(w=>(sum+=w.sum)/60),lo=Math.min(0,...values),hi=Math.max(0,...values);
 const yMin=lo===hi?lo-1:lo-0.5,yMax=lo===hi?hi+1:hi+0.5;
 const width=340,height=148,left=39,right=20,top=15,bottom=33,x=i=>left+i*(width-left-right)/5,y=v=>top+(yMax-v)/(yMax-yMin)*(height-top-bottom);
 const pts=values.map((v,i)=>[x(i),y(v)]),line=pts.map(([px,py],i)=>`${i?'L':'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
 const area=`${line} L ${x(5)} ${height-bottom} L ${x(0)} ${height-bottom} Z`;
 const baseline=y(0).toFixed(1);
 el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Saldo acumulado das últimas seis semanas: ${values.map(v=>v.toFixed(2)+' horas').join(', ')}">
  <defs><linearGradient id="bankGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#36bd89" stop-opacity=".28"/><stop offset="100%" stop-color="#36bd89" stop-opacity=".02"/></linearGradient></defs>
  <path d="M ${left} ${baseline} H ${width-right}" stroke="#91a3bf" stroke-dasharray="4,4" stroke-width="1" fill="none"/>
  <path d="${area}" fill="url(#bankGradient)"/><path d="${line}" fill="none" stroke="#16a674" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  ${pts.map(([px,py])=>`<circle cx="${px}" cy="${py}" r="4" fill="#13a874" stroke="white" stroke-width="1.5"/>`).join('')}
  ${weeks.map((w,i)=>`<text x="${x(i)}" y="${height-8}" text-anchor="middle" fill="#6c809c" font-size="10">${w.label}</text>`).join('')}
  <text x="${left-6}" y="${top+4}" text-anchor="end" fill="#6c809c" font-size="9">${yMax.toFixed(1)}h</text><text x="${left-6}" y="${height-bottom+3}" text-anchor="end" fill="#6c809c" font-size="9">${yMin.toFixed(1)}h</text>
 </svg>`;
}
function renderCorrections(){
 const el=$('correctionsDays');if(!el)return;
 const corrected=marks.filter(m=>m.original_at).sort((a,b)=>b.day.localeCompare(a.day)||a.mark_idx-b.mark_idx);
 el.innerHTML=corrected.length?corrected.map(m=>`<section class="card day-card"><div><div class="title">${dateLabel(m.day)} · ${escapeHtml(dayLabels(m.day)[m.mark_idx]||'Marcação')}</div><p>Original: ${timeOf(m.original_at)} → Atual: ${timeOf(m.at)}</p><button type="button" data-edit="${m.day}">Ver / corrigir</button></div><span class="status-label">Corrigido</span></section>`).join(''):'<div class="card empty">Você ainda não corrigiu horários. Alterações feitas no Histórico aparecerão aqui.</div>';
}
function setHistoryFilter(which){const corrected=which==='corrected';$('historyDays').hidden=corrected;$('correctionsDays').hidden=!corrected;$('historyAll').classList.toggle('selected',!corrected);$('historyCorrected').classList.toggle('selected',corrected);}
function selectReportPeriod(){const field=$('reportMonth').value;if(!/^\d{4}-\d{2}$/.test(field))return false;const [y,m]=field.split('-').map(Number);if(y<2000||y>2100||m<1||m>12)return false;calendarView=new Date(y,m-1,1);renderCalendar();renderBankChart();renderReports();return true;}
function renderReports(){
 if(!profile||!$('reportMonth'))return;
 $('reportMonth').value=`${calendarView.getFullYear()}-${String(calendarView.getMonth()+1).padStart(2,'0')}`;
 const s=monthStats();$('reportWorked').textContent=hr(s.workedMin);$('reportBalance').textContent=signed(s.saldo);$('reportBalance').className=s.saldo<0?'negative':'positive';$('reportCompleted').textContent=String(s.completed);$('reportIncomplete').textContent=String(s.missing);
}
function chosenReport(){const all=$('reportType').value==='espelho';const rows=monthRows();if(all)return {headers:CSV_HEADERS,rows};const cols=[0,1,2,7,8,9,10];return {headers:cols.map(i=>CSV_HEADERS[i]),rows:rows.map(r=>cols.map(i=>r[i]))};}
// Criação de XLSX compatível com Excel: pacote ZIP OOXML sem compressão.
function createXlsx(headers,rows){
 const enc=new TextEncoder(),escape=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const colName=n=>{let result='';for(n++;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
 const all=[headers,...rows],sheetRows=all.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>`<c r="${colName(c)}${r+1}" t="inlineStr"${r===0?' s="1"':''}><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join('')}</row>`).join('');
 const entries=[
 ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
 ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
 ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Jornada+" sheetId="1" r:id="rId1"/></sheets></workbook>'],
 ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
 ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1250D6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf xfId="0" fontId="0" fillId="0" borderId="0"/><xf xfId="0" fontId="1" fillId="1" borderId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
 ['xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols>${headers.map((_,i)=>`<col min="${i+1}" max="${i+1}" width="${i===0?16:21}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData></worksheet>`]
 ];
 const out=[],central=[];let offset=0;
 const u16=n=>[n&255,(n>>8)&255],u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
 function crc32(buf){let crc=~0;for(let byte of buf){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (~crc)>>>0;}
 function append(arr){out.push(...arr);offset+=arr.length;}
 for(const [name,body] of entries){const nameBytes=enc.encode(name),data=enc.encode(body),crc=crc32(data),pos=offset;
  append([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...nameBytes,...data]);
  central.push([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(pos),...nameBytes]);
 }
 const cdStart=offset;for(const c of central)append(c);const size=offset-cdStart;
 append([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(size),...u32(cdStart),...u16(0)]);
 return new Blob([new Uint8Array(out)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function exportXlsx(){if(!selectReportPeriod())return notify('Selecione um mês válido.',true);const {headers,rows}=chosenReport(),file=createXlsx(headers,rows),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=`Jornada_${$('reportType').value}_${$('reportMonth').value}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);notify('Planilha Excel gerada.');}
function printReportV5(){if(!selectReportPeriod())return notify('Selecione um mês válido.',true);
 const {headers,rows}=chosenReport(),st=monthStats();$('printReport').innerHTML=`<h1>Jornada+ · ${$('reportType').value==='espelho'?'Espelho de ponto':'Banco de horas'}</h1><p>Usuário: ${escapeHtml(profile.name)} · ${escapeHtml($('reportMonth').value)}</p><div class="print-summary"><b>Horas trabalhadas:</b> ${hr(st.workedMin)} &nbsp; <b>Saldo:</b> ${signed(st.saldo)}</div><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Controle pessoal, não é documento oficial de ponto.</p>`;window.print();}
let installEvent=null;
function applyTheme(mode){if(!['light','dark','auto'].includes(mode))mode='light';try{localStorage.setItem('jornada_v5_theme',mode);}catch(e){}
 const dark=mode==='dark'||mode==='auto'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches;document.body.classList.toggle('theme-dark',!!dark);if($('themeSelect'))$('themeSelect').value=mode;}
function installApp(){if(installEvent){installEvent.prompt();installEvent.userChoice.then(()=>installEvent=null);return;}notify('Para instalar: abra o menu do navegador e escolha “Adicionar à tela inicial”.');}
function v5Setup(){try{applyTheme(localStorage.getItem('jornada_v5_theme')||'light');}catch(e){applyTheme('light');}
 $('historyAll').addEventListener('click',()=>setHistoryFilter('all'));
 $('historyCorrected').addEventListener('click',()=>setHistoryFilter('corrected'));
 $('reportMonth').addEventListener('change',selectReportPeriod);
 $('reportType').addEventListener('change',renderReports);
 $('reportPdf').addEventListener('click',printReportV5);
 $('reportExcel').addEventListener('click',exportXlsx);
 $('themeSelect').addEventListener('change',e=>applyTheme(e.target.value));
 $('installApp').addEventListener('click',installApp);
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('installHint').textContent='Este aparelho permite instalar o Jornada+ pela opção acima.';});
 window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change',()=>{if($('themeSelect').value==='auto')applyTheme('auto');});
 if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

function wire(){for(const mode of ['Login','Signup'])$('mode'+mode).addEventListener('click',()=>setAuthMode(mode==='Signup'?'signup':'login'));$('authForm').addEventListener('submit',onAuthSubmit);$('forgotPassword').addEventListener('click',forgot);$('requestReset').addEventListener('click',resetPassword);$('signOut').addEventListener('click',signOut);$('signOutTop').addEventListener('click',signOut);
 $('registerNow').addEventListener('click',()=>automatic());$('photoRegister').addEventListener('click',()=>$('cameraInput').click());$('cameraInput').addEventListener('change',e=>{const file=e.target.files?.[0];e.target.value='';if(file)automatic(file);});$('openManual').addEventListener('click',openManual);$('manualDate').addEventListener('change',updateManual);$('manualForm').addEventListener('submit',submitManual);
 $('manualTakePhoto').addEventListener('click',()=>$('manualCameraInput').click());
 $('manualChooseImage').addEventListener('click',()=>$('manualGalleryInput').click());
 $('manualCameraInput').addEventListener('change',e=>{chooseManualPhoto(e.target.files?.[0],'Foto da câmera');e.target.value='';});
 $('manualGalleryInput').addEventListener('change',e=>{chooseManualPhoto(e.target.files?.[0],'Imagem da galeria');e.target.value='';});
 $('manualRemovePhoto').addEventListener('click',clearManualPhoto);
 $('dayForm').addEventListener('submit',saveDay);$('deleteDay').addEventListener('click',deleteDay);$('saveNote').addEventListener('click',saveNote);$('saveSettings').addEventListener('click',saveSettings);$('schedulePreset').addEventListener('change',applyPreset);$('hasInterval').addEventListener('change',scheduleFormVisibility);$('importLegacy').addEventListener('click',()=>$('legacyFile').click());$('legacyFile').addEventListener('change',importLegacy);$('prevMonth').addEventListener('click',()=>shiftMonth(-1));$('nextMonth').addEventListener('click',()=>shiftMonth(1));$('exportCsv').addEventListener('click',exportCsv);$('printMonth').addEventListener('click',printMonth);$('calendarDayAction').addEventListener('click',calendarAction);$('enterDemo').addEventListener('click',enterDemo);$('clearDemo').addEventListener('click',clearDemo);
 document.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;if(btn.dataset.go)selectTab(btn.dataset.go);if(btn.dataset.tab)selectTab(btn.dataset.tab);if(btn.dataset.edit)openDay(btn.dataset.edit);if(btn.dataset.photo)showPicture(btn.dataset.photo);if(btn.dataset.calendarDay)openCalendarDay(btn.dataset.calendarDay);if(btn.dataset.close)hideModal(btn.dataset.close);});document.querySelectorAll('.modal-backdrop').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)hideModal(el.id);}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-backdrop').forEach(m=>m.hidden=true);});}
async function boot(){wire();v5Setup();setAuthMode('login');clock();clockTimer=setInterval(clock,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)clock();});const config=window.JORNADA_SUPABASE||{};if(!config.url||!config.anonKey){$('configNotice').hidden=false;$('authSubmit').disabled=true;$('modeSignup').disabled=true;return;}
 if(!window.supabase){authMessage('Não foi possível carregar a biblioteca de conexão. Verifique a internet.',true);return;}
 try{realApi=window.supabase.createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});api=realApi;
 realApi.auth.onAuthStateChange((event,session)=>{if(isDemo)return;if(event==='PASSWORD_RECOVERY'){setTimeout(()=>changePassword(),0);return;}if(event==='SIGNED_OUT'){exit();return;}if((event==='SIGNED_IN'||event==='INITIAL_SESSION')&&session?.user){setTimeout(()=>enter(session.user),0);}});
 const {data,error}=await api.auth.getSession();if(error)throw error;if(data.session?.user)await enter(data.session.user);
 }catch(e){authMessage('Erro de conexão: '+e.message,true);}}
boot();
})();
