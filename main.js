const TOOTH_PATH = "M224 0C170 0 112 12 68 40 24 68 -4 110 6 165c7 40 24 118 47 165 20 41 40 62 61 62 21 0 30-18 35-46 4-24 8-38 16-38s12 14 16 38c5 28 14 46 35 46 21 0 41-21 61-62 23-47 40-125 47-165 10-55-18-97-62-125C336 12 278 0 224 0Z";
const UPPER_TEETH = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const LOWER_TEETH = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
const PRIMARY_UPPER_TEETH = [55,54,53,52,51,61,62,63,64,65];
const PRIMARY_LOWER_TEETH = [85,84,83,82,81,71,72,73,74,75];
let currentDentition = 'adult';

let settings = { clinicName:'', clinicSub:'', clinicFacebook:'', exRate:4100, invoicePrefix:'', appointmentStartTime:'08:00', appointmentEndTime:'17:00', appointmentDuration:30 };
let rows = []; // {tooth, treatment, qty, price}
let toothState = {}; // {num: 'untreated'|'treated'}
let currentPatientKey = null;
let activePatientId = '';
let presetServices = [];
let pendingToothIndices = [];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPiwRHcLf21WlLfwQi8gufOwo2vER6Idw",
  authDomain: "myclinic-e2837.firebaseapp.com",
  projectId: "myclinic-e2837",
  storageBucket: "myclinic-e2837.firebasestorage.app",
  messagingSenderId: "323594166146",
  appId: "1:323594166146:web:c2e60a163d1f30b2b9799b",
  measurementId: "G-V3YR657RKK"
};

function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- local persistent storage (works on any web server, survives refresh) ---------- */
const LocalStore = {
  async get(key){
    try{
      const v = localStorage.getItem(key);
      return v!==null ? {key, value:v} : null;
    }catch(e){ return null; }
  },
  async set(key, value){
    try{
      localStorage.setItem(key, value);
      return {key, value};
    }catch(e){ return null; }
  }
};


/* ---------- toast notifications ---------- */
function showToast(message, type){
  type = type || 'info';
  let container = document.getElementById('toastContainer');
  if(!container){
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icon = type==='success' ? '✅' : type==='error' ? '⚠️' : 'ℹ️';
  const toast = document.createElement('div');
  toast.className = 'toast toast-'+type;
  toast.innerHTML = '<span class="toast-icon">'+icon+'</span><span class="toast-msg">'+esc(message)+'</span>';
  container.appendChild(toast);
  requestAnimationFrame(()=>toast.classList.add('show'));
  setTimeout(()=>{
    toast.classList.remove('show');
    setTimeout(()=>toast.remove(), 250);
  }, 2800);
}

/* ---------- custom confirm modal (replaces native confirm()) ---------- */
function showConfirm(message, opts){
  opts = opts || {};
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal confirm-modal" role="alertdialog">' +
        '<div class="confirm-icon">'+(opts.icon || '❓')+'</div>' +
        '<p class="confirm-message">'+esc(message)+'</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" data-action="cancel">'+esc(opts.cancelLabel || 'បោះបង់')+'</button>' +
          '<button class="btn btn-danger" data-action="ok">'+esc(opts.okLabel || 'យល់ព្រម')+'</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    function close(result){
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(), 180);
      resolve(result);
    }
    overlay.addEventListener('click', e=>{
      if(e.target===overlay){ close(false); return; }
      const btn = e.target.closest('button[data-action]');
      if(btn) close(btn.dataset.action==='ok');
    });
  });
}


/* ---------- generic modal ---------- */
function closeModal(){
  const overlay = document.getElementById('activeModalOverlay');
  if(!overlay) return;
  overlay.classList.remove('show');
  setTimeout(()=>overlay.remove(), 180);
}
function openModal(innerHtml, extraClass){
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'activeModalOverlay';
  overlay.innerHTML = '<div class="modal '+(extraClass||'')+'">'+innerHtml+'</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });
  requestAnimationFrame(()=>overlay.classList.add('show'));
  return overlay;
}

/* ---------- nav / views ---------- */
function switchView(name){
  const viewName = name==='treatments' ? 'invoice' : name;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const target = document.getElementById('view-'+viewName);
  if(target) target.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  window.scrollTo({top:0, behavior:'smooth'});
  if(name==='prescription') refreshPrescriptionView();
  if(name==='dashboard') loadDashboard();
  if(name==='patients') loadPatientsView();
  if(viewName==='invoice') loadInvoicePatientOptions();
  if(name==='appointments') loadAppointmentsView();
  if(name==='reports') loadReports();
}
function clearAllSilent(){
  rows = [];
  toothState = {};
  currentPatientKey = null;
  activePatientId = '';
  pendingToothIndices = [];
  loadedInvoiceId = null;
  document.getElementById('surname').value='';
  document.getElementById('givenName').value='';
  document.getElementById('gender').value='';
  document.getElementById('age').value='';
  document.getElementById('patientPhone').value='';
  document.getElementById('invoicePatientSelect').value='';
  document.getElementById('doctorName').value=settings.doctorName || '';
  document.getElementById('cashierName').value=settings.cashierName || '';
  document.getElementById('discountValue').value=0;
  document.getElementById('depositValue').value=0;
  document.getElementById('depositCurrency').value='usd';
  document.getElementById('invoiceNotes').value='';
  // main.js

document.addEventListener('DOMContentLoaded', () => {
    
    // ដាក់កូដរបស់អ្នកទាំងអស់នៅទីនេះ...
    
    const printBtn = document.getElementById('printBtn'); // ឧទាហរណ៍ ID ប៊ូតុង Print
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // កូដផ្សេងៗទៀត...

});
  peekInvoiceNo().then(no=>{ document.getElementById('invoiceNo').value = no; });
  updatePendingLabel();
  renderRows();
  renderTeeth();
}
async function newInvoice(){
  const hasData = rows.length>0 ||
    document.getElementById('surname').value.trim() ||
    document.getElementById('givenName').value.trim();
  if(hasData){
    const ok = await showConfirm('ចាប់ផ្ដើមវិក្កយបត្រថ្មី? ទិន្នន័យបច្ចុប្បន្នដែលមិនទាន់រក្សាទុក នឹងបាត់។', {icon:'🧾', okLabel:'បង្កើតថ្មី'});
    if(!ok) return;
  }
  clearAllSilent();
  switchView('invoice');
  showToast('ត្រៀមរួចរាល់សម្រាប់វិក្កយបត្រថ្មី', 'success');
}

/* ---------- settings ---------- */
function updateClinicHeaderDisplay(){
  const name = settings.clinicName || 'We Trust Dental Clinic';
  const sub = settings.clinicSub || 'Tel: 092 463 646 | Phnom Penh, Cambodia';
  const fb = settings.clinicFacebook || '';
  const logo = settings.clinicLogo || '';
  const address = settings.clinicAddress || '';
  const email = settings.clinicEmail || '';
  const website = settings.clinicWebsite || '';
  const phone = settings.clinicPhone || '';
  const nameEl = document.getElementById('clinicNameDisplay');
  const subEl = document.getElementById('clinicSubDisplay');
  const fbEl = document.getElementById('clinicFbDisplay');
  const navEl = document.getElementById('navClinicName');
  const rxNameEl = document.getElementById('rxClinicNameDisplay');
  const rxSubEl = document.getElementById('rxClinicSubDisplay');
  const logoEl = document.getElementById('clinicLogoImg');
  const rxLogoEl = document.getElementById('rxClinicLogoImg');
  if(nameEl) nameEl.textContent = name;
  if(subEl) subEl.textContent = sub;
  if(fbEl) fbEl.textContent = fb;
  if(navEl) navEl.textContent = name;
  if(rxNameEl) rxNameEl.textContent = name;
  if(rxSubEl) rxSubEl.textContent = sub;
  [logoEl, rxLogoEl].forEach(el=>{
    if(!el) return;
    if(logo){ el.src = logo; el.style.display = 'inline-block'; }
    else{ el.style.display = 'none'; el.removeAttribute('src'); }
  });

  // invoice print letterhead
  const invLogoEl = document.getElementById('invPrintLogo');
  if(invLogoEl){
    if(logo){ invLogoEl.src = logo; invLogoEl.style.display = 'inline-block'; }
    else{ invLogoEl.style.display = 'none'; invLogoEl.removeAttribute('src'); }
  }
  const nameKhEl = document.getElementById('invPrintNameKh');
  if(nameKhEl) nameKhEl.textContent = name;

  setRowText('invPrintEmailRow', 'invPrintEmail', email, 'Email');
  setRowText('invPrintWebsiteRow', 'invPrintWebsite', website, 'Website');
  setRowText('invPrintFbRow', 'invPrintFb', fb, 'Facebook');
  setRowText('invPrintPhoneRow', 'invPrintPhone', phone, 'Tel');

  const addrEl = document.getElementById('invPrintAddress');
  if(addrEl){
    addrEl.textContent = address;
    addrEl.style.display = address ? 'block' : 'none';
  }
}
function setRowText(rowId, spanId, value, label){
  const row = document.getElementById(rowId);
  const span = document.getElementById(spanId);
  if(!row || !span) return;
  span.textContent = value;
  row.style.display = value ? 'block' : 'none';
}
function renderLogoPreview(){
  const preview = document.getElementById('clinicLogoPreview');
  if(!preview) return;
  if(settings.clinicLogo){
    preview.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<img src="'+settings.clinicLogo+'" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--line);">' +
        '<button class="del-btn" onclick="removeClinicLogo()">✕ លុប Logo</button>' +
      '</div>';
  }else{
    preview.innerHTML = '';
  }
}
async function handleLogoUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    showToast('សូមជ្រើសរើសឯកសាររូបភាព', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function(ev){
    settings.clinicLogo = ev.target.result;
    try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(err){}
    updateClinicHeaderDisplay();
    renderLogoPreview();
    showToast('បានបញ្ចូល Logo រួចរាល់', 'success');
  };
  reader.readAsDataURL(file);
}
async function removeClinicLogo(){
  delete settings.clinicLogo;
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
  updateClinicHeaderDisplay();
  renderLogoPreview();
  const input = document.getElementById('clinicLogoInput');
  if(input) input.value = '';
  showToast('បានលុប Logo រួចរាល់', 'success');
}
async function loadSettings(){
  try{
    const r = await LocalStore.get('clinic-settings');
    if(r && r.value) settings = JSON.parse(r.value);
  }catch(e){}
  settings.invoicePrefix = settings.invoicePrefix || '';
  settings.appointmentStartTime = settings.appointmentStartTime || '08:00';
  settings.appointmentEndTime = settings.appointmentEndTime || '17:00';
  settings.appointmentDuration = Number(settings.appointmentDuration) || 30;
  document.getElementById('clinicName').value = settings.clinicName || 'We Trust Dental Clinic';
  document.getElementById('clinicSub').value = settings.clinicSub || 'Tel: 092 463 646 | Phnom Penh, Cambodia';
  document.getElementById('clinicFacebook').value = settings.clinicFacebook || '';
  document.getElementById('clinicAddress').value = settings.clinicAddress || '';
  document.getElementById('clinicEmail').value = settings.clinicEmail || '';
  document.getElementById('clinicWebsite').value = settings.clinicWebsite || '';
  document.getElementById('clinicPhone').value = settings.clinicPhone || '';
  document.getElementById('exRate').value = settings.exRate || 4100;
  document.getElementById('doctorName').value = settings.doctorName || '';
  document.getElementById('cashierName').value = settings.cashierName || '';
  document.getElementById('invoicePrefix').value = settings.invoicePrefix;
  document.getElementById('nextInvoiceNumber').value = await peekInvoiceCounter();
  document.getElementById('appointmentStartTime').value = settings.appointmentStartTime;
  document.getElementById('appointmentEndTime').value = settings.appointmentEndTime;
  document.getElementById('appointmentDuration').value = String(settings.appointmentDuration);
  updateAppointmentHoursHint();
  updateClinicHeaderDisplay();
  renderLogoPreview();
}
async function saveSettings(){
  settings = {
    clinicName: document.getElementById('clinicName').value.trim(),
    clinicSub: document.getElementById('clinicSub').value.trim(),
    clinicFacebook: document.getElementById('clinicFacebook').value.trim(),
    clinicAddress: document.getElementById('clinicAddress').value.trim(),
    clinicEmail: document.getElementById('clinicEmail').value.trim(),
    clinicWebsite: document.getElementById('clinicWebsite').value.trim(),
    clinicPhone: document.getElementById('clinicPhone').value.trim(),
    exRate: parseFloat(document.getElementById('exRate').value) || 4100,
    doctorName: settings.doctorName,
    cashierName: settings.cashierName,
    clinicLogo: settings.clinicLogo,
    invoicePrefix: settings.invoicePrefix || '',
    appointmentStartTime: settings.appointmentStartTime || '08:00',
    appointmentEndTime: settings.appointmentEndTime || '17:00',
    appointmentDuration: Number(settings.appointmentDuration) || 30
  };
  let saved = null;
  try{ saved = await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){ console.error('Save clinic settings:',e); }
  updateClinicHeaderDisplay();
  renderTotals();
  return Boolean(saved);
}
document.getElementById('clinicAddress').addEventListener('input', saveSettings);
document.getElementById('clinicEmail').addEventListener('input', saveSettings);
document.getElementById('clinicWebsite').addEventListener('input', saveSettings);
document.getElementById('clinicPhone').addEventListener('input', saveSettings);
document.getElementById('clinicName').addEventListener('input', saveSettings);
document.getElementById('clinicSub').addEventListener('input', saveSettings);
document.getElementById('clinicFacebook').addEventListener('input', saveSettings);
document.getElementById('exRate').addEventListener('input', saveSettings);
document.getElementById('discountValue')?.addEventListener('input', renderTotals);
document.getElementById('discountType').addEventListener('change', renderTotals);
document.getElementById('depositValue').addEventListener('input', renderTotals);
document.getElementById('depositCurrency').addEventListener('change', renderTotals);
document.getElementById('doctorName').addEventListener('change', async ()=>{
  settings.doctorName = document.getElementById('doctorName').value.trim();
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
});
document.getElementById('cashierName').addEventListener('change', async ()=>{
  settings.cashierName = document.getElementById('cashierName').value.trim();
  try{ await LocalStore.set('clinic-settings', JSON.stringify(settings)); }catch(e){}
});

function updateAppointmentHoursHint(){
  const hint = document.getElementById('appointmentHoursHint');
  if(hint){
    hint.textContent = 'ម៉ោងបើក '+(settings.appointmentStartTime||'08:00')+'–'+(settings.appointmentEndTime||'17:00')+' · រយៈពេល '+(Number(settings.appointmentDuration)||30)+' នាទី';
  }
}
async function saveOperationalSettings(){
  const prefix = document.getElementById('invoicePrefix').value.trim();
  const nextNumber = Number(document.getElementById('nextInvoiceNumber').value);
  const opening = document.getElementById('appointmentStartTime').value;
  const closing = document.getElementById('appointmentEndTime').value;
  const duration = Number(document.getElementById('appointmentDuration').value);
  if(!Number.isSafeInteger(nextNumber) || nextNumber < 1){
    showToast('លេខវិក្កយបត្របន្ទាប់ត្រូវតែជាចំនួនគត់ ចាប់ពី 1 ឡើងទៅ', 'error');
    return;
  }
  if(!opening || !closing || opening >= closing || ![15,30,45,60,90,120].includes(duration)){
    showToast('សូមកំណត់ម៉ោងបើក/បិទ និងរយៈពេលណាត់ឱ្យបានត្រឹមត្រូវ', 'error');
    return;
  }
  const currentNextNumber = await peekInvoiceCounter();
  if(nextNumber < currentNextNumber){
    document.getElementById('nextInvoiceNumber').value = currentNextNumber;
    showToast('មិនអាចបន្ថយលេខបន្ទាប់ក្រោម '+currentNextNumber+' បានទេ ដើម្បីជៀសវាងលេខវិក្កយបត្រស្ទួន', 'error');
    return;
  }
  settings.invoicePrefix = prefix;
  settings.appointmentStartTime = opening;
  settings.appointmentEndTime = closing;
  settings.appointmentDuration = duration;
  try{
    if(!await saveSettings()) throw new Error('មិនអាចរក្សាទុកការកំណត់គ្លីនិកបានទេ');
    const saved = await LocalStore.set('invoice-counter', String(nextNumber - 1));
    if(!saved) throw new Error('មិនអាចរក្សាទុកលេខវិក្កយបត្របានទេ');
    document.getElementById('invoiceNo').value = await peekInvoiceNo();
    updateAppointmentHoursHint();
    showToast('បានរក្សាទុកការកំណត់វិក្កយបត្រ និងការណាត់ជួប', 'success');
  }catch(e){
    console.error('Save operational settings:', e);
    showToast('មិនអាចរក្សាទុកការកំណត់បានទេ៖ '+(e.message||'សូមព្យាយាមម្ដងទៀត'), 'error');
  }
}

const BACKUP_LOCAL_KEYS = ['clinic-settings','invoice-counter','discount-pref','preset-services','preset-medications'];
function getBackupLocalStorage(){
  const data = {};
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(key && (BACKUP_LOCAL_KEYS.includes(key) || key.startsWith('dental-chart:') || key.startsWith('rx:'))){
      data[key] = localStorage.getItem(key);
    }
  }
  return data;
}
async function exportClinicBackup(){
  try{
    const { collection, getDocs } = await import(FS_URL);
    const db = await getFbDb();
    const collectionNames = ['patients','invoices','appointments'];
    const snapshots = await Promise.all(collectionNames.map(name=>getDocs(collection(db,name))));
    const records = {};
    snapshots.forEach((snapshot,index)=>{
      records[collectionNames[index]] = snapshot.docs.map(item=>({id:item.id,data:item.data()}));
    });
    const backup = {
      format:'myclinic-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      collections:records,
      localStorage:getBackupLocalStorage()
    };
    const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'myclinic-backup-'+new Date().toISOString().slice(0,10)+'.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('បានទាញយក Backup រួចរាល់', 'success');
  }catch(e){
    console.error('Export clinic backup:',e);
    showToast('មិនអាចទាញយក Backup បានទេ៖ '+(e.message||'សូមពិនិត្យការតភ្ជាប់ Firestore'), 'error');
  }
}
async function importClinicBackup(input){
  const file = input.files && input.files[0];
  if(!file) return;
  input.value = '';
  try{
    if(file.size > 50*1024*1024) throw new Error('ឯកសារ Backup ធំពេក (កំណត់អតិបរមា 50 MB)');
    const backup = JSON.parse(await file.text());
    if(!backup || backup.format!=='myclinic-backup' || backup.version!==1 || !backup.collections || typeof backup.collections!=='object'){
      throw new Error('ទម្រង់ឯកសារ Backup មិនត្រឹមត្រូវ ឬមិនត្រូវបានគាំទ្រ');
    }
    const collectionNames = ['patients','invoices','appointments'];
    const records = {};
    for(const name of collectionNames){
      const entries = backup.collections[name] === undefined ? [] : backup.collections[name];
      if(!Array.isArray(entries)) throw new Error('បញ្ជី '+name+' ក្នុង Backup មិនត្រឹមត្រូវ');
      records[name] = entries.map(entry=>{
        if(!entry || typeof entry.id!=='string' || !entry.id.trim() || entry.id.includes('/') || !entry.data || typeof entry.data!=='object' || Array.isArray(entry.data)){
          throw new Error('មានកំណត់ត្រាមិនត្រឹមត្រូវក្នុង '+name);
        }
        return {id:entry.id,data:entry.data};
      });
    }
    const localData = backup.localStorage === undefined ? {} : backup.localStorage;
    if(!localData || typeof localData!=='object' || Array.isArray(localData)){
      throw new Error('ទិន្នន័យ Settings ក្នុង Backup មិនត្រឹមត្រូវ');
    }
    const allowedLocalKey = key=>BACKUP_LOCAL_KEYS.includes(key) || key.startsWith('dental-chart:') || key.startsWith('rx:');
    for(const [key,value] of Object.entries(localData)){
      if(!allowedLocalKey(key) || typeof value!=='string') throw new Error('មានការកំណត់មិនត្រឹមត្រូវក្នុង Backup');
    }
    const total = collectionNames.reduce((sum,name)=>sum+records[name].length,0);
    const confirmed = await showConfirm('Restore នឹងបញ្ចូល '+total+' កំណត់ត្រាតាម ID និងស្ដារ Settings ក្នុង browser នេះ។ វាមិនលុបទិន្នន័យដែលមានស្រាប់ទេ។ បន្តមែនទេ?',{icon:'⬆️',okLabel:'Restore'});
    if(!confirmed) return;
    const { collection, doc, writeBatch } = await import(FS_URL);
    const db = await getFbDb();
    for(const name of collectionNames){
      for(let offset=0;offset<records[name].length;offset+=450){
        const batch = writeBatch(db);
        records[name].slice(offset,offset+450).forEach(item=>{
          batch.set(doc(collection(db,name),item.id),item.data,{merge:true});
        });
        await batch.commit();
      }
    }
    for(const [key,value] of Object.entries(localData)){
      if(key==='invoice-counter'){
        const importedCounter = Number.parseInt(value,10);
        const currentCounter = Number.parseInt(localStorage.getItem(key)||'0',10);
        if(Number.isSafeInteger(importedCounter) && importedCounter > currentCounter){
          const saved = await LocalStore.set(key,String(importedCounter));
          if(!saved) throw new Error('មិនអាចស្ដារលេខវិក្កយបត្របានទេ');
        }
      }else{
        const saved = await LocalStore.set(key,value);
        if(!saved) throw new Error('មិនអាចស្ដារ Settings '+key+' បានទេ');
      }
    }
    showToast('Restore បានបញ្ចប់។ កំពុងផ្ទុកទិន្នន័យឡើងវិញ…','success');
    setTimeout(()=>window.location.reload(),900);
  }catch(e){
    console.error('Import clinic backup:',e);
    showToast('Restore មិនបានពេញលេញទេ៖ '+(e.message||'សូមពិនិត្យឯកសារ និង Firestore Rules'), 'error');
  }
}

/* ---------- tooth chart ---------- */
function patientKey(){
  if(activePatientId) return 'dental-chart:'+activePatientId;
  const sn = document.getElementById('surname').value.trim().toLowerCase();
  const gn = document.getElementById('givenName').value.trim().toLowerCase();
  const full = (sn+' '+gn).trim();
  return full ? 'dental-chart:'+full : null;
}
function handleManualPatientInput(){
  if(activePatientId){
    activePatientId = '';
    document.getElementById('invoicePatientSelect').value = '';
  }
  loadToothChartForPatient();
}
function selectPatientForInvoice(id){
  const patient = dbPatients.find(p => p.id === id);
  activePatientId = patient ? patient.id : '';
  if(!patient){
    ['surname','givenName','gender','age','patientPhone'].forEach(field => {
      document.getElementById(field).value = '';
    });
    loadToothChartForPatient();
    return;
  }
  const parts = String(patient.name||'').trim().split(/\s+/);
  document.getElementById('surname').value = parts.shift() || '';
  document.getElementById('givenName').value = parts.join(' ');
  document.getElementById('gender').value = patient.gender || '';
  document.getElementById('age').value = patient.age || '';
  document.getElementById('patientPhone').value = patient.phone || '';
  loadToothChartForPatient();
}
async function loadToothChartForPatient(){
  const key = patientKey();
  if(!key){ toothState = {}; currentPatientKey = null; renderTeeth(); return; }
  currentPatientKey = key;
  try{
    const r = await LocalStore.get(key);
    toothState = (r && r.value) ? JSON.parse(r.value) : {};
  }catch(e){ toothState = {}; }
  renderTeeth();
}
async function saveToothChart(){
  if(!currentPatientKey) return;
  try{ await LocalStore.set(currentPatientKey, JSON.stringify(toothState)); }catch(e){}
}

// បង្កើត Firestore instance តែម្ដងគត់ ហើយប្រើឡើងវិញគ្រប់កន្លែង
let fbDb = null;
async function getFbDb() {
  if (fbDb) return fbDb;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js");
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const app = initializeApp(FIREBASE_CONFIG);
  fbDb = getFirestore(app);
  return fbDb;
}

// រក្សាទុកដោយកំណត់ document ID ខ្លួនឯង (setDoc) ជំនួស addDoc ID ចៃដន្យ
// ដូច្នេះ history អាចផ្ទុកមកវិញបានតាម id ដដែល
async function saveToFirebase(id, invoiceData) {
  try {
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    const db = await getFbDb();
    await setDoc(doc(db, "invoices", id), invoiceData);
    console.log("រក្សាទុកទៅ Firebase ជោគជ័យ!");
  } catch (e) {
    console.error("កំហុសក្នុងការរក្សាទុក:", e);
    throw e;
  }
}

// ទាញយក invoice មួយ ពី Firebase តាម id
async function fetchInvoiceRecord(id) {
  const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const db = await getFbDb();
  const snap = await getDoc(doc(db, "invoices", id));
  return snap.exists() ? snap.data() : null;
}

function cycleTooth(num){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  const cur = toothState[num] || 'normal';
  const next = cur==='normal' ? 'untreated' : (cur==='untreated' ? 'treated' : 'normal');

  if(next==='normal'){
    delete toothState[num];
    const idx = rows.findIndex(r=>String(r.tooth)===String(num) && !r.treatment);
    if(idx!==-1){
      rows.splice(idx,1);
      pendingToothIndices = pendingToothIndices.filter(i=>i!==idx).map(i=>i>idx ? i-1 : i);
      renderRows();
      updatePendingLabel();
    }
    saveToothChart();
    renderTeeth();
    return;
  }

  toothState[num] = next;
  saveToothChart();

  let idx = rows.findIndex(r=>String(r.tooth)===String(num) && !r.treatment);
  if(idx===-1){
    rows.push({tooth:num, treatment:'', qty:1, price:0});
    idx = rows.length-1;
  }
  if(!pendingToothIndices.includes(idx)){
    pendingToothIndices.push(idx);
  }
  renderRows();
  renderTeeth();
  updatePendingLabel();
  document.getElementById('serviceInput').focus();
}
function selectRange(start, end){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  const nums = [];
  for(let n=start; n<=end; n++) nums.push(n);
  selectTeeth(nums);
}
function selectTeeth(nums){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(nums);
}
function selectAllTeeth(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(currentDentition==='child'
    ? [...PRIMARY_UPPER_TEETH,...PRIMARY_LOWER_TEETH]
    : [...UPPER_TEETH,...LOWER_TEETH]);
}
function selectAllUpper(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(currentDentition==='child' ? PRIMARY_UPPER_TEETH : UPPER_TEETH);
}
function selectAllLower(){
  if(!currentPatientKey){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺមុន', 'error');
    return;
  }
  toggleSelection(currentDentition==='child' ? PRIMARY_LOWER_TEETH : LOWER_TEETH);
}
/* ---------- toggle: if every tooth in nums is already marked, clicking again clears them; ---------- */
/* ---------- otherwise it selects them. Rows with a treatment already saved are never deleted. ---------- */
function toggleSelection(nums){
  const allMarked = nums.every(n => toothState[n]==='untreated' || toothState[n]==='treated');
  if(allMarked){
    nums.forEach(num=>{ delete toothState[num]; });
    rows = rows.filter(r => !(nums.map(String).includes(String(r.tooth)) && !r.treatment));
    saveToothChart();
    pendingToothIndices = [];
    renderRows();
    renderTeeth();
    updatePendingLabel();
    showToast('បានដកការជ្រើសរើសធ្មេញចេញ', 'info');
  }else{
    applyPendingSelection(nums);
  }
}
function applyPendingSelection(nums){
  const indices = [];
  nums.forEach(num=>{
    if(!(toothState[num]==='untreated' || toothState[num]==='treated')){
      toothState[num] = 'untreated';
    }
    let idx = rows.findIndex(r=>String(r.tooth)===String(num) && !r.treatment);
    if(idx===-1){
      rows.push({tooth:num, treatment:'', qty:1, price:0});
      idx = rows.length-1;
    }
    indices.push(idx);
  });
  saveToothChart();
  pendingToothIndices = indices;
  renderRows();
  renderTeeth();
  updatePendingLabel();
  document.getElementById('serviceInput').focus();
}
function updatePendingLabel(){
  const el = document.getElementById('pendingLabel');
  const valid = pendingToothIndices.filter(i=>rows[i]);
  if(valid.length>0){
    el.style.display='inline-block';
    const nums = valid.map(i=>rows[i].tooth);
    el.textContent = 'កំពុងជ្រើសរើសសេវាកម្មសម្រាប់ធ្មេញលេខ ' + nums.join(', ');
  }else{
    el.style.display='none';
  }
}
function toothBtn(num){
  const state = toothState[num] || 'normal';
  return `<button class="tooth-btn ${state}" onclick="cycleTooth(${num})" title="ធ្មេញលេខ ${num}">
    <svg viewBox="0 0 448 512"><path d="${TOOTH_PATH}" stroke-width="6"/></svg>
    <span class="num">${num}</span>
  </button>`;
}
function renderTeeth(){
  document.getElementById('upperRow').innerHTML =
    UPPER_TEETH.slice(0,8).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    UPPER_TEETH.slice(8).map(toothBtn).join('');
  document.getElementById('lowerRow').innerHTML =
    LOWER_TEETH.slice(0,8).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    LOWER_TEETH.slice(8).map(toothBtn).join('');
  document.getElementById('childUpperRow').innerHTML =
    PRIMARY_UPPER_TEETH.slice(0,5).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    PRIMARY_UPPER_TEETH.slice(5).map(toothBtn).join('');
  document.getElementById('childLowerRow').innerHTML =
    PRIMARY_LOWER_TEETH.slice(0,5).map(toothBtn).join('') +
    '<span class="quad-divider"></span>' +
    PRIMARY_LOWER_TEETH.slice(5).map(toothBtn).join('');
}
function setDentition(type){
  currentDentition = type==='child' ? 'child' : 'adult';
  document.getElementById('adultToothChart').hidden = currentDentition==='child';
  document.getElementById('childToothChart').hidden = currentDentition!=='child';
  document.getElementById('adultDentitionBtn').classList.toggle('active',currentDentition==='adult');
  document.getElementById('childDentitionBtn').classList.toggle('active',currentDentition==='child');
  document.getElementById('adultDentitionBtn').setAttribute('aria-pressed',String(currentDentition==='adult'));
  document.getElementById('childDentitionBtn').setAttribute('aria-pressed',String(currentDentition==='child'));
}
document.getElementById('surname').addEventListener('input', handleManualPatientInput);
document.getElementById('givenName').addEventListener('input', handleManualPatientInput);
['gender','age','patientPhone'].forEach(id => {
  document.getElementById(id).addEventListener('input', handleManualPatientInput);
  document.getElementById(id).addEventListener('change', handleManualPatientInput);
});

/* ---------- item rows ---------- */
async function loadPresetServices(){
  try{
    const r = await LocalStore.get('preset-services');
    if(r && r.value) presetServices = JSON.parse(r.value);
  }catch(e){
    presetServices = [
      {id:'s1', name:'ជូតធ្មេញ', price:8},
      {id:'s2', name:'ខួងធ្មេញ', price:15},
      {id:'s3', name:'ដកធ្មេញ', price:10},
      {id:'s4', name:'ឆ្នូតធ្មេញ', price:5}
    ];
    await savePresetServices();
  }
  renderServiceOptions();
  renderServiceManageList();
}
async function savePresetServices(){
  try{ await LocalStore.set('preset-services', JSON.stringify(presetServices)); }catch(e){}
}
function renderServiceOptions(){
  document.getElementById('serviceOptions').innerHTML =
    presetServices.map(s=>`<option value="${esc(s.name)}"></option>`).join('');
}
function renderServiceManageList(){
  const list = document.getElementById('serviceManageList');
  if(!list) return;
  if(presetServices.length===0){
    list.innerHTML = '<div style="font-size:11.5px;color:#a9b8b5;">មិនទាន់មានសេវាកម្មទេ</div>';
    return;
  }
  list.innerHTML = presetServices.map(s=>`
    <div class="service-manage-item">
      <span>${esc(s.name)} — $${Number(s.price).toFixed(2)}</span>
      <button class="del-btn" onclick="deletePresetService('${s.id}')">✕</button>
    </div>`).join('');
}
async function deletePresetService(id){
  const svc = presetServices.find(s=>s.id===id);
  const ok = await showConfirm('លុបសេវាកម្ម "'+(svc?svc.name:'')+'" ចេញពីបញ្ជី?', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  presetServices = presetServices.filter(s=>s.id!==id);
  await savePresetServices();
  renderServiceOptions();
  renderServiceManageList();
  showToast('បានលុបសេវាកម្មរួចរាល់', 'success');
}
async function addPresetServiceDirect(){
  const nameEl = document.getElementById('newServiceName');
  const priceEl = document.getElementById('newServicePrice');
  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  if(!name){ nameEl.focus(); return; }
  if(isNaN(price)){ priceEl.focus(); return; }
  if(presetServices.some(s=>s.name===name)){
    showToast('សេវាកម្មនេះមានរួចហើយ', 'error');
    return;
  }
  presetServices.push({id:'s'+Date.now(), name, price});
  await savePresetServices();
  renderServiceOptions();
  renderServiceManageList();
  nameEl.value=''; priceEl.value='';
  nameEl.focus();
  showToast('បានបន្ថែមសេវាកម្មរួចរាល់', 'success');
}
function onServiceInputChange(){
  const name = document.getElementById('serviceInput').value.trim();
  const match = presetServices.find(s=>s.name===name);
  if(match){
    document.getElementById('servicePriceInput').value = match.price;
  }
}
async function addServiceToInvoice(){
  const name = document.getElementById('serviceInput').value.trim();
  const price = parseFloat(document.getElementById('servicePriceInput').value);
  const qty = parseFloat(document.getElementById('serviceQtyInput').value) || 1;
  if(!name || isNaN(price)) return;

  if(pendingToothIndices.length>0){
    pendingToothIndices.forEach(idx=>{
      if(rows[idx]){
        rows[idx].treatment = name;
        rows[idx].price = price;
        rows[idx].qty = qty;
      }
    });
    pendingToothIndices = [];
  }else{
    rows.push({tooth:'', treatment:name, qty:qty, price:price});
  }

  const exists = presetServices.some(s=>s.name===name);
  if(!exists){
    presetServices.push({id:'s'+Date.now(), name, price});
    await savePresetServices();
    renderServiceOptions();
    renderServiceManageList();
  }
  document.getElementById('serviceInput').value='';
  document.getElementById('servicePriceInput').value='';
  document.getElementById('serviceQtyInput').value=1;
  document.getElementById('serviceInput').focus();
  updatePendingLabel();
  renderRows();
}

function addRow(){
  rows.push({tooth:'', treatment:'', qty:1, price:0});
  renderRows();
}
function updateRow(idx, field, value){
  if(field==='qty' || field==='price') value = parseFloat(value)||0;
  rows[idx][field] = value;
  renderRows();
}
function removeRow(idx){
  rows.splice(idx,1);
  pendingToothIndices = pendingToothIndices
    .filter(i=>i!==idx)
    .map(i=>i>idx ? i-1 : i);
  updatePendingLabel();
  renderRows();
}
function compactToothRange(teethArr){
  if(teethArr.length===0) return '';
  const sorted = [...teethArr].map(Number).sort((a,b)=>a-b);
  let consecutive = true;
  for(let i=1;i<sorted.length;i++){
    if(sorted[i]!==sorted[i-1]+1){ consecutive = false; break; }
  }
  if(consecutive && sorted.length>1) return sorted[0]+'-'+sorted[sorted.length-1];
  return sorted.join(', ');
}
function renderPrintRows(){
  const tbody = document.getElementById('printRows');
  if(rows.length===0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">មិនទាន់មានធាតុនៅឡើយទេ</td></tr>';
    return;
  }
  const groups = {};
  const order = [];
  rows.forEach(r=>{
    const key = (r.treatment||'')+'|'+(r.price||0);
    if(!groups[key]){
      groups[key] = {treatment:r.treatment, price:Number(r.price)||0, teeth:[], qty:0};
      order.push(key);
    }
    if(r.tooth!=='' && r.tooth!=null) groups[key].teeth.push(r.tooth);
    groups[key].qty += (r.qty||0);
  });
  tbody.innerHTML = order.map(key=>{
    const g = groups[key];
    const subtotal = g.qty * g.price;
    const toothLabel = compactToothRange(g.teeth);
    const priceLabel = g.price===0 ? 'Free' : '$'+g.price.toFixed(2);
    const subtotalLabel = g.price===0 ? 'Free' : '$'+subtotal.toFixed(2);
    return `<tr>
      <td>${esc(toothLabel)}</td>
      <td>${esc(g.treatment)}</td>
      <td class="num">${g.qty}</td>
      <td class="num">${priceLabel}</td>
      <td class="num">${subtotalLabel}</td>
    </tr>`;
  }).join('');
}
function renderRows(){
  const tbody = document.getElementById('rows');
  if(rows.length===0){
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">មិនទាន់មានធាតុនៅឡើយទេ — ចុច + ដើម្បីបញ្ចូល</td></tr>';
  }else{
    tbody.innerHTML = rows.map((r,idx)=>{
      const subtotal = (r.qty||0) * (r.price||0);
      const subtotalLabel = (r.price||0)===0 ? 'Free' : '$'+subtotal.toFixed(2);
      return `<tr>
        <td class="tooth-cell"><input value="${esc(String(r.tooth))}" placeholder="#" onchange="updateRow(${idx},'tooth',this.value)"></td>
        <td><input value="${esc(r.treatment)}" placeholder="Treatment" onchange="updateRow(${idx},'treatment',this.value)"></td>
        <td class="num"><input class="qty" type="number" min="1" value="${r.qty}" onchange="updateRow(${idx},'qty',this.value)"></td>
        <td class="num"><input class="price" type="number" step="0.01" value="${r.price}" onchange="updateRow(${idx},'price',this.value)" placeholder="0 = Free"></td>
        <td class="num subtotal-cell">${subtotalLabel}</td>
        <td><button class="del-btn" onclick="removeRow(${idx})">✕</button></td>
      </tr>`;
    }).join('');
  }
  renderTotals();
  renderPrintRows();
}
function renderTotals(){
  const subtotalUsd = rows.reduce((s,r)=>s+(r.qty||0)*(r.price||0),0);
  const discVal = parseFloat(document.getElementById('discountValue').value) || 0;
  const discType = document.getElementById('discountType').value;
  const discountUsd = discType==='percent' ? subtotalUsd*(discVal/100) : discVal;
  const totalUsd = Math.max(0, subtotalUsd - discountUsd);
  const rate = parseFloat(document.getElementById('exRate').value)||4100;

  const depositRaw = parseFloat(document.getElementById('depositValue').value) || 0;
  const depositCurrency = document.getElementById('depositCurrency').value;
  const deposit = depositCurrency==='khr' ? (depositRaw / rate) : depositRaw;
  const balance = Math.max(0, totalUsd - deposit);

  document.getElementById('subtotalLine').textContent = '$'+subtotalUsd.toFixed(2);
  document.getElementById('grandUsd').textContent = '$'+totalUsd.toFixed(2);
  document.getElementById('grandKhr').textContent = '≈ '+Math.round(totalUsd*rate).toLocaleString('en-US')+' ៛';
  document.getElementById('balanceDue').textContent = '$'+balance.toFixed(2);
  document.getElementById('balanceDueKhr').textContent = '≈ '+Math.round(balance*rate).toLocaleString('en-US')+' ៛';
  document.getElementById('totalPaidDisplay').textContent = '$'+deposit.toFixed(2);

  // ប្រសិនបើមិនបញ្ចុះតម្លៃទេ (Discount = 0) មិនបាច់បង្ហាញ Grand Total / Paid / Due / Total Paid ទេ — បង្ហាញតែ Sub Total
  const showExtra = discVal > 0;
  ['grandTotalRow','paidRow','totalDueRow','totalPaidRow'].forEach(rowId=>{
    const el = document.getElementById(rowId);
    if(el) el.style.display = showExtra ? 'table-row' : 'none';
  });
  const totalsTableEl = document.getElementById('invTotalsTable');
  if(totalsTableEl) totalsTableEl.classList.toggle('inv-totals-boxed', showExtra);

  const rateLine = document.getElementById('rateDisplayLine');
  if(rateLine) rateLine.textContent = '1$ = '+Math.round(rate).toLocaleString('en-US')+' ៛';
}

async function loadDiscountPref(){
  try{
    const r = await LocalStore.get('discount-pref');
    if(r && r.value){
      const d = JSON.parse(r.value);
      document.getElementById('discountValue').value = d.value || 0;
      document.getElementById('discountType').value = d.type || 'percent';
    }
  }catch(e){}
}
async function peekInvoiceCounter(){
  let counter = 1000;
  try{
    const r = await LocalStore.get('invoice-counter');
    if(r && r.value) counter = parseInt(r.value) || 1000;
  }catch(e){}
  return counter + 1;
}
async function peekInvoiceNo(){
  return (settings.invoicePrefix||'') + await peekInvoiceCounter();
}
async function getNextInvoiceNo(){
  return await peekInvoiceNo();
}
async function advanceInvoiceCounter(){
  const nextNumber = await peekInvoiceCounter();
  const saved = await LocalStore.set('invoice-counter', String(nextNumber));
  if(!saved) throw new Error('មិនអាចធ្វើបច្ចុប្បន្នភាពលេខវិក្កយបត្របានទេ');
  const nextNumberInput = document.getElementById('nextInvoiceNumber');
  if(nextNumberInput) nextNumberInput.value = nextNumber + 1;
}
let loadedInvoiceId = null;
let invoiceIndex = [];

function invoiceRecordToIndexEntry(id, record){
  const subtotal = (record.rows||[]).reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
  const discVal = parseFloat(record.discountValue)||0;
  const discType = record.discountType || 'percent';
  const discAmt = discType==='percent' ? subtotal*(discVal/100) : discVal;
  const total = Math.max(0, subtotal-discAmt);
  const deposit = parseFloat(record.depositValue)||0;
  const balance = Math.max(0, total-deposit);
  let status = 'unpaid';
  if(deposit>0 && balance<=0.004) status='paid'; else if(deposit>0) status='partial';
  return { id, fullName: record.fullName, date: record.date, total,
           invoiceNo: record.invoiceNo, doctorName: record.doctorName, deposit, balance, status };
}
async function loadInvoiceIndex(){
  try{
    const { collection, getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
    const db = await getFbDb();
    const q = query(collection(db, "invoices"), orderBy("savedAt", "desc"));
    const snap = await getDocs(q);
    invoiceIndex = snap.docs.map(d => invoiceRecordToIndexEntry(d.id, d.data()));
  }catch(e){ console.error('មិនអាចទាញយកប្រវត្តិវិក្កយបត្របានទេ:', e); invoiceIndex = []; }
}
async function saveInvoiceAndPrint() {
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  const fullName = (surname + ' ' + givenName).trim();
  const isNewInvoice = !loadedInvoiceId;

  if (fullName && rows.length > 0) {
    if (!loadedInvoiceId && !document.getElementById('invoiceNo').value.trim()) {
      const no = await getNextInvoiceNo();
      document.getElementById('invoiceNo').value = no;
    }

    const totalUsd = (function () {
      const subtotal = rows.reduce((s, r) => s + (r.qty || 0) * (r.price || 0), 0);
      const discVal = parseFloat(document.getElementById('discountValue').value) || 0;
      const discType = document.getElementById('discountType').value;
      const disc = discType === 'percent' ? subtotal * (discVal / 100) : discVal;
      return Math.max(0, subtotal - disc);
    })();

    const id = loadedInvoiceId || ('inv_' + Date.now());
    let patientId = activePatientId;
    try{
      if(!patientId){
        patientId = await ensurePatient(fullName, document.getElementById('patientPhone').value, document.getElementById('gender').value, document.getElementById('age').value);
        activePatientId = patientId;
        renderPatientSelectors();
        document.getElementById('invoicePatientSelect').value = patientId;
      }
    }catch(e){
      console.error('Patient ID:',e);
      showToast('មិនអាចបង្កើត ឬភ្ជាប់ Patient ID បានទេ។ វិក្កយបត្រមិនត្រូវបានរក្សាទុកទេ។', 'error');
      return;
    }
    if(!patientId){
      showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺ ដើម្បីភ្ជាប់វិក្កយបត្រទៅ Patient ID', 'error');
      return;
    }
    const record = {
      id, patientId, surname, givenName, fullName,
      invoiceNo: document.getElementById('invoiceNo').value,
      cashierName: document.getElementById('cashierName').value,
      gender: document.getElementById('gender').value,
      age: document.getElementById('age').value,
      patientPhone: document.getElementById('patientPhone').value,
      doctorName: document.getElementById('doctorName').value,
      date: document.getElementById('invDate').value,
      rows: JSON.parse(JSON.stringify(rows)),
      discountValue: document.getElementById('discountValue').value,
      discountType: document.getElementById('discountType').value,
      depositValue: document.getElementById('depositValue').value,
      depositCurrency: document.getElementById('depositCurrency').value,
      notes: document.getElementById('invoiceNotes').value,
      total: totalUsd,
      savedAt: new Date().toISOString()
    };

    // រក្សាទុកទៅ Firebase (source of truth តែមួយ)
    try{
      await saveToFirebase(id, record);
    }catch(e){
      showToast('មិនអាចរក្សាទុកវិក្កយបត្របានទេ។ សូមពិនិត្យការតភ្ជាប់ និង Firestore Rules។', 'error');
      return;
    }
    clinicStale = true;

    loadedInvoiceId = id;
    if(isNewInvoice){
      try{
        await advanceInvoiceCounter();
      }catch(e){
        console.error('Advance invoice number:',e);
        showToast('វិក្កយបត្របានរក្សាទុក ប៉ុន្តែមិនអាចធ្វើបច្ចុប្បន្នភាពលេខបន្ទាប់បានទេ', 'error');
      }
    }
    invoiceIndex = invoiceIndex.filter(r => r.id !== id);
    invoiceIndex.unshift(invoiceRecordToIndexEntry(id, record));
    applyHistoryFilters();
    showToast('វិក្កយបត្របានរក្សាទុករួចរាល់', 'success');
    autoClearAfterPrint = true;
  }
  const subtotalForPrint = rows.reduce((sum,row) => sum + (row.qty||0)*(row.price||0),0);
  const discountValueForPrint = parseFloat(document.getElementById('discountValue').value)||0;
  const discountTypeForPrint = document.getElementById('discountType').value;
  const discountForPrint = discountTypeForPrint==='percent'
    ? subtotalForPrint*discountValueForPrint/100
    : discountValueForPrint;
  document.body.classList.toggle('print-no-discount',discountForPrint<=0);
  fillPrintLetterhead();
  window.print();
}
function fillPrintLetterhead(){
  const setText = (id, val)=>{ const el = document.getElementById(id); if(el) el.textContent = val || ''; };
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  const dateVal = document.getElementById('invDate').value;
  let dateLabel = dateVal;
  if(dateVal){
    const d = new Date(dateVal+'T00:00:00');
    if(!isNaN(d)) dateLabel = d.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric'});
  }
  setText('invPrintDate', dateLabel);
  setText('invPrintCashier', document.getElementById('cashierName').value);
  setText('invPrintDoctor', document.getElementById('doctorName').value);
  setText('invPrintPatientName', (surname + ' ' + givenName).trim());
  setText('invPrintGender', document.getElementById('gender').value);
  setText('invPrintAge', document.getElementById('age').value);
  setText('invPrintPatientPhone', document.getElementById('patientPhone').value);
}
let autoClearAfterPrint = false;
window.addEventListener('afterprint', ()=>{
  document.body.classList.remove('print-no-discount');
  if(autoClearAfterPrint){
    autoClearAfterPrint = false;
    clearAllSilent();
    showToast('ទម្រង់វិក្កយបត្រត្រូវបានសម្អាត ត្រៀមសម្រាប់ភ្ញៀវបន្ទាប់', 'info');
  }
});
let historyFilter = 'all';
function applyHistoryFilters(){
  const q = document.getElementById('historySearch').value.trim().toLowerCase();
  let list = invoiceIndex;
  if(q) list = list.filter(r=>r.fullName.toLowerCase().includes(q));
  if(historyFilter !== 'all') list = list.filter(r=>r.status===historyFilter);
  renderHistoryList(list.slice(0,50), list.length);
}
function setHistoryFilter(f){
  historyFilter = f;
  document.querySelectorAll('.filter-pill').forEach(b=>b.classList.toggle('active', b.dataset.filter===f));
  applyHistoryFilters();
}
// លុប invoice មួយ ចេញពី Firebase តាម id
async function deleteInvoiceRecordFromFirebase(id) {
  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js");
  const db = await getFbDb();
  await deleteDoc(doc(db, "invoices", id));
}
async function deleteInvoice(id){
  const rec = invoiceIndex.find(r=>r.id===id);
  const name = rec ? rec.fullName : '';
  const ok = await showConfirm('លុបវិក្កយបត្រ'+(name?(' របស់ "'+name+'"'):'')+' ចេញពីប្រវត្តិ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  try{
    await deleteInvoiceRecordFromFirebase(id);
    invoiceIndex = invoiceIndex.filter(r=>r.id!==id);
    applyHistoryFilters();
    showToast('បានលុបវិក្កយបត្ររួចរាល់', 'success');
  }catch(e){
    showToast('មិនអាចលុបវិក្កយបត្របានទេ', 'error');
  }
}
function statusBadge(status){
  if(status==='paid') return '<span class="status-badge status-paid">✅ បង់គ្រប់</span>';
  if(status==='partial') return '<span class="status-badge status-partial">🟡 បង់ខ្លះ</span>';
  if(status==='unpaid') return '<span class="status-badge status-unpaid">🔴 មិនទាន់បង់</span>';
  return '<span class="status-badge status-unknown">—</span>';
}
function renderHistoryList(list, totalCount){
  const el = document.getElementById('historyList');
  const countEl = document.getElementById('historyCount');
  if(countEl) countEl.textContent = (totalCount!=null ? totalCount : (list?list.length:0)) + ' វិក្កយបត្រ';
  if(!list || list.length===0){
    el.innerHTML = '<div class="history-empty">មិនទាន់មានប្រវត្តិត្រូវនឹងលក្ខខណ្ឌនេះទេ</div>';
    return;
  }
  el.innerHTML = list.map(r=>{
    const initial = esc((r.fullName||'?').trim().charAt(0).toUpperCase() || '?');
    const inv = r.invoiceNo ? '#'+esc(String(r.invoiceNo))+' · ' : '';
    return `
    <div class="history-item">
      <div class="history-item-left">
        <div class="history-avatar">${initial}</div>
        <div class="history-item-info">
          <div class="hi-name">${esc(r.fullName)}</div>
          <div class="hi-meta">${inv}${esc(r.date||'')} · $${Number(r.total).toFixed(2)}</div>
        </div>
      </div>
      <div class="history-item-right">
        ${statusBadge(r.status)}
        <button class="history-load-btn" onclick="openHistoryDetail('${r.id}')">បើកមើល</button>
        <button class="history-del-btn" onclick="deleteInvoice('${r.id}')" title="លុប">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
async function openHistoryDetail(id){
  try{
    const rec = await fetchInvoiceRecord(id);
    if(!rec){ showToast('រកមិនឃើញវិក្កយបត្រនេះទេ', 'error'); return; }
    const subtotal = (rec.rows||[]).reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
    const discVal = parseFloat(rec.discountValue)||0;
    const discType = rec.discountType || 'percent';
    const discAmt = discType==='percent' ? subtotal*(discVal/100) : discVal;
    const total = Math.max(0, subtotal-discAmt);
    const deposit = parseFloat(rec.depositValue)||0;
    const balance = Math.max(0, total-deposit);
    let status = 'unpaid';
    if(deposit>0 && balance<=0.004) status='paid'; else if(deposit>0) status='partial';

    const itemsHtml = (rec.rows||[]).length===0
      ? '<tr><td colspan="4" class="empty-row">មិនមានធាតុ</td></tr>'
      : rec.rows.map(x=>`<tr>
          <td>${esc(String(x.tooth||'—'))}</td>
          <td>${esc(x.treatment||'')}</td>
          <td class="num">${x.qty||0}</td>
          <td class="num">${(x.price||0)===0?'Free':'$'+Number((x.qty||0)*(x.price||0)).toFixed(2)}</td>
        </tr>`).join('');

    const html = `
      <div class="modal-header">
        <div>
          <h3>${esc(rec.fullName)} ${statusBadge(status)}</h3>
          <div class="modal-subtitle">Invoice #${esc(String(rec.invoiceNo||'—'))} · ${esc(rec.date||'')}</div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          <div><label>គ្រូពេទ្យ</label><span>${esc(rec.doctorName||'—')}</span></div>
          <div><label>អ្នកគិតលុយ</label><span>${esc(rec.cashierName||'—')}</span></div>
          <div><label>ភេទ / អាយុ</label><span>${esc(rec.gender||'—')} / ${esc(String(rec.age||'—'))}</span></div>
          <div><label>លេខទូរស័ព្ទ</label><span>${esc(rec.patientPhone||'—')}</span></div>
        </div>
        <table class="items detail-items">
          <thead><tr><th>Tooth#</th><th>Treatment</th><th class="num">Qty</th><th class="num">Subtotal</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div class="detail-totals">
          <div><span>Subtotal</span><b>$${subtotal.toFixed(2)}</b></div>
          <div><span>បញ្ចុះតម្លៃ</span><b>-$${discAmt.toFixed(2)}</b></div>
          <div class="detail-total-grand"><span>សរុប / Total</span><b>$${total.toFixed(2)}</b></div>
          <div><span>ប្រាក់កក់</span><b>$${deposit.toFixed(2)}</b></div>
          <div class="detail-balance"><span>នៅសល់ត្រូវបង់</span><b>$${balance.toFixed(2)}</b></div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">បិទ</button>
        <button class="btn btn-danger" onclick="closeModal(); deleteInvoice('${id}');">🗑️ លុប</button>
        <button class="btn btn-primary" onclick="closeModal(); loadInvoiceById('${id}');">✏️ ផ្ទុកទៅកែសម្រួល/បោះពុម្ព</button>
      </div>`;
    openModal(html, 'detail-modal');
  }catch(e){ showToast('មានបញ្ហាក្នុងការបើកមើលវិក្កយបត្រ', 'error'); }
}
async function loadInvoiceById(id){
  try{
    const rec = await fetchInvoiceRecord(id);
    if(!rec) return;
    await loadClinicData();
    activePatientId = rec.patientId || '';
    renderPatientSelectors();
    if(activePatientId) selectPatientForInvoice(activePatientId);
    document.getElementById('surname').value = rec.surname || '';
    document.getElementById('givenName').value = rec.givenName || '';
    document.getElementById('invoiceNo').value = rec.invoiceNo || '';
    document.getElementById('cashierName').value = rec.cashierName || '';
    document.getElementById('gender').value = rec.gender || '';
    document.getElementById('age').value = rec.age || '';
    document.getElementById('patientPhone').value = rec.patientPhone || '';
    document.getElementById('doctorName').value = rec.doctorName || '';
    document.getElementById('invDate').value = rec.date || '';
    document.getElementById('discountValue').value = rec.discountValue || 0;
    document.getElementById('discountType').value = rec.discountType || 'percent';
    document.getElementById('depositValue').value = rec.depositValue || 0;
    document.getElementById('depositCurrency').value = rec.depositCurrency || 'usd';
    document.getElementById('invoiceNotes').value = rec.notes || '';
    rows = rec.rows || [];
    pendingToothIndices = [];
    loadedInvoiceId = rec.id;
    await loadToothChartForPatient();
    renderRows();
    updatePendingLabel();
    switchView('invoice');
    showToast('បានផ្ទុកវិក្កយបត្ររបស់ '+rec.fullName, 'success');
  }catch(e){ showToast('មិនអាចផ្ទុកវិក្កយបត្រនេះបានទេ', 'error'); }
}

async function clearAll(){
  const ok = await showConfirm('សម្អាតទិន្នន័យទាំងអស់ក្នុងវិក្កយបត្រនេះ?', {icon:'🗑️', okLabel:'សម្អាត'});
  if(!ok) return;
  clearAllSilent();
  showToast('សម្អាតទិន្នន័យរួចរាល់', 'success');
}

/* ---------- prescription ---------- */
let rxMedications = []; // draft list: {name, dosage, qty}
let presetMedications = []; // {id, name, dosage}

async function loadPresetMedications(){
  try{
    const r = await LocalStore.get('preset-medications');
    if(r && r.value) presetMedications = JSON.parse(r.value);
  }catch(e){ presetMedications = []; }
  renderMedOptions();
  renderMedManageList();
}
async function savePresetMedications(){
  try{ await LocalStore.set('preset-medications', JSON.stringify(presetMedications)); }catch(e){}
}
function renderMedOptions(){
  const dl = document.getElementById('rxMedOptions');
  if(dl) dl.innerHTML = presetMedications.map(m=>`<option value="${esc(m.name)}"></option>`).join('');
}
function renderMedManageList(){
  const list = document.getElementById('medManageList');
  if(!list) return;
  if(presetMedications.length===0){
    list.innerHTML = '<div style="font-size:11.5px;color:#a9b8b5;">មិនទាន់មានថ្នាំរក្សាទុកទេ</div>';
    return;
  }
  list.innerHTML = presetMedications.map(m=>`
    <div class="service-manage-item">
      <span>${esc(m.name)}${m.dosage ? (' — '+esc(m.dosage)) : ''}</span>
      <button class="del-btn" onclick="deletePresetMedication('${m.id}')">✕</button>
    </div>`).join('');
}
async function deletePresetMedication(id){
  const med = presetMedications.find(m=>m.id===id);
  const ok = await showConfirm('លុបថ្នាំ "'+(med?med.name:'')+'" ចេញពីបញ្ជី?', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  presetMedications = presetMedications.filter(m=>m.id!==id);
  await savePresetMedications();
  renderMedOptions();
  renderMedManageList();
  showToast('បានលុបថ្នាំរួចរាល់', 'success');
}
async function addPresetMedicationDirect(){
  const nameEl = document.getElementById('newMedName');
  const dosageEl = document.getElementById('newMedDosage');
  const name = nameEl.value.trim();
  const dosage = dosageEl.value.trim();
  if(!name){ nameEl.focus(); return; }
  if(presetMedications.some(m=>m.name===name)){
    showToast('ថ្នាំនេះមានរួចហើយ', 'error');
    return;
  }
  presetMedications.push({id:'m'+Date.now(), name, dosage});
  await savePresetMedications();
  renderMedOptions();
  renderMedManageList();
  nameEl.value=''; dosageEl.value='';
  nameEl.focus();
  showToast('បានបន្ថែមថ្នាំរួចរាល់', 'success');
}
function onRxMedNameChange(){
  const name = document.getElementById('rxMedName').value.trim();
  const match = presetMedications.find(m=>m.name===name);
  if(match && match.dosage){
    document.getElementById('rxMedDosage').value = match.dosage;
  }
}

function rxKey(){
  const key = patientKey();
  if(!key) return null;
  return key.replace('dental-chart:', 'rx:');
}
function rxDraftKey(){
  const key = rxKey();
  return key ? key + ':draft' : null;
}
async function saveRxDraft(){
  const key = rxDraftKey();
  if(!key) return;
  try{ await LocalStore.set(key, JSON.stringify(rxMedications)); }catch(e){}
}
async function loadRxDraft(){
  const key = rxDraftKey();
  if(!key){ rxMedications = []; renderRxMedTable(); return; }
  try{
    const r = await LocalStore.get(key);
    rxMedications = (r && r.value) ? JSON.parse(r.value) : [];
  }catch(e){ rxMedications = []; }
  renderRxMedTable();
}
async function clearRxDraft(){
  const key = rxDraftKey();
  if(!key) return;
  try{ await LocalStore.set(key, JSON.stringify([])); }catch(e){}
}
function refreshPrescriptionView(){
  const surname = document.getElementById('surname').value.trim();
  const givenName = document.getElementById('givenName').value.trim();
  const fullName = (surname + ' ' + givenName).trim();
  const gender = document.getElementById('gender').value;
  const age = document.getElementById('age').value;
  const phone = document.getElementById('patientPhone').value.trim();
  const doctor = document.getElementById('doctorName').value.trim();

  document.getElementById('rxPatientName').textContent = fullName || '—';
  document.getElementById('rxPatientGenderAge').textContent = (gender || '—') + ' / ' + (age || '—');
  document.getElementById('rxPatientPhone').textContent = phone || '—';
  document.getElementById('rxPatientDoctor').textContent = doctor || '—';

  const hint = document.getElementById('rxNoPatientHint');
  const saveBtn = document.getElementById('rxSaveBtn');
  const printBtn = document.getElementById('rxPrintBtn');
  if(fullName){
    hint.style.display = 'none';
    saveBtn.disabled = false;
    printBtn.disabled = false;
  }else{
    hint.style.display = 'block';
    saveBtn.disabled = true;
    printBtn.disabled = true;
  }
  loadRxDraft();
  loadRxHistory();
}
function addMedication(){
  const nameEl = document.getElementById('rxMedName');
  const dosageEl = document.getElementById('rxMedDosage');
  const qtyEl = document.getElementById('rxMedQty');

  const name = nameEl ? nameEl.value.trim() : '';
  const dosage = dosageEl ? dosageEl.value.trim() : '';
  const qty = qtyEl ? (parseInt(qtyEl.value) || 1) : 1;
  const days = 0; // កំណត់ 0 ដោយស្វ័យប្រវត្តិ (មិនបាច់មាន input days ទេ)

  if(!name){ 
    if(nameEl) nameEl.focus(); 
    if(typeof showToast === 'function') showToast('សូមបញ្ចូលឈ្មោះថ្នាំ', 'error'); 
    return; 
  }

  rxMedications.push({name, dosage, qty, days});
  renderRxMedTable();
  if(typeof saveRxDraft === 'function') saveRxDraft();

  // Reset input វិញក្រោយបន្ថែមរួច
  if(nameEl) nameEl.value = '';
  if(dosageEl) dosageEl.value = '';
  if(qtyEl) qtyEl.value = '1';
}

function addMedication(){
  const nameEl = document.getElementById('rxMedName');
  const dosageEl = document.getElementById('rxMedDosage');
  const qtyEl = document.getElementById('rxMedQty');

  const name = nameEl ? nameEl.value.trim() : '';
  const dosage = dosageEl ? dosageEl.value.trim() : '';
  const qty = qtyEl ? (parseInt(qtyEl.value) || 1) : 1;
  const days = 0; // កំណត់ 0 ដោយស្វ័យប្រវត្តិ (មិនបាច់មាន input days ទេ)

  if(!name){ 
    if(nameEl) nameEl.focus(); 
    if(typeof showToast === 'function') showToast('សូមបញ្ចូលឈ្មោះថ្នាំ', 'error'); 
    return; 
  }       

  rxMedications.push({name, dosage, qty, days});
  renderRxMedTable();
  if(typeof saveRxDraft === 'function') saveRxDraft();

  // Reset input វិញក្រោយបន្ថែមរួច
  if(nameEl) nameEl.value = '';
  if(dosageEl) dosageEl.value = '';
  if(qtyEl) qtyEl.value = '1';
}

function renderRxMedTable() {
  const tbody = document.getElementById('rxMedList');
  if (!tbody) return;

  if (rxMedications.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">មិនទាន់មានថ្នាំបញ្ចូលនៅឡើយទេ</td></tr>`;
    return;
  }

  // 💡 កែប្រែកន្លែងនេះ៖ ឱ្យត្រូវតាម ៥ ជួរឈរ (ល.រ, ឈ្មោះថ្នាំ, របៀបប្រើ, ចំនួន, ប៊ូតុងលុប)
  tbody.innerHTML = rxMedications.map((med, index) => `
    <tr>
      <td class="text-center">${index + 1}</td>
      <td><b>${med.name}</b></td>
      <td>${med.dosage || '-'}</td>
      <td class="text-center">${med.qty}</td>
      <td class="text-center">
        <button type="button" onclick="removeMedication(${index})" style="color:red; border:none; background:none; cursor:pointer;">❌</button>
      </td>
    </tr>
  `).join('');
}
function removeMedication(index) {
  rxMedications.splice(index, 1);
  renderRxMedTable();
  if(typeof saveRxDraft === 'function') saveRxDraft();
}

  const exists = presetMedications.some(m=>m.name===name);
  if(!exists){
 
    
    savePresetMedications();
    renderMedOptions();
    renderMedManageList();
  }

  


function removeMedication(idx){
  rxMedications.splice(idx,1);
  renderRxMedTable();
  saveRxDraft();
}
async function loadRxHistory(){
  const key = rxKey();
  const list = document.getElementById('rxHistoryList');
  if(!key){
    list.innerHTML = '<p class="text-muted text-center">សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន</p>';
    return;
  }
  let entries = [];
  try{
    const r = await LocalStore.get(key);
    if(r && r.value) entries = JSON.parse(r.value);
  }catch(e){ entries = []; }
  if(entries.length===0){
    list.innerHTML = '<p class="text-muted text-center">មិនទាន់មានប្រវត្តិវេជ្ជបញ្ជាទេ</p>';
    return;
  }
  list.innerHTML = entries.slice().reverse().map(e=>{
    const meds = (e.items||[]).map(m=>
      `<div class="presc-history-med">💊 ${esc(m.name)} ${m.dosage?('— '+esc(m.dosage)):''} ${m.qty?('(x'+esc(String(m.qty))+')'):''} ${m.days?(' · '+esc(String(m.days))+'ថ្ងៃ'):''}</div>`
    ).join('');
    return `<div class="presc-history-item">
      <div class="presc-history-date">${esc(e.date)}</div>
      ${meds || '<div class="presc-history-med text-muted">—</div>'}
    </div>`;
  }).join('');
}
async function persistPrescription(){
  const key = rxKey();
  if(!key || rxMedications.length===0) return false;
  let entries = [];
  try{
    const r = await LocalStore.get(key);
    if(r && r.value) entries = JSON.parse(r.value);
  }catch(e){ entries = []; }
  entries.push({
    date: new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}),
    items: JSON.parse(JSON.stringify(rxMedications))
  });
  try{ await LocalStore.set(key, JSON.stringify(entries)); }catch(e){}
  return true;
}
async function savePrescription(){
  const key = rxKey();
  if(!key){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន', 'error');
    return;
  }
  if(rxMedications.length===0){
    showToast('សូមបញ្ចូលថ្នាំយ៉ាងហោចណាស់មួយមុនរក្សាទុក', 'error');
    return;
  }
  const ok = await persistPrescription();
  if(ok){
    rxMedications = [];
    renderRxMedTable();
    await clearRxDraft();
    loadRxHistory();
    showToast('វេជ្ជបញ្ជាបានរក្សាទុករួចរាល់', 'success');
  }
}
async function savePrescriptionAndPrint(){
  const key = rxKey();
  if(!key){
    showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺនៅផ្ទាំង "វិក្កយបត្រ" សិន', 'error');
    return;
  }
  if(rxMedications.length===0){
    showToast('សូមបញ្ចូលថ្នាំយ៉ាងហោចណាស់មួយមុនបោះពុម្ព', 'error');
    return;
  }
  await persistPrescription();
  loadRxHistory();
  const dateEl = document.getElementById('rxPrintDate');
  if(dateEl) dateEl.textContent = new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  document.body.classList.add('print-rx');
  autoClearRxAfterPrint = true;
  window.print();
}
let autoClearRxAfterPrint = false;
window.addEventListener('afterprint', ()=>{
  if(document.body.classList.contains('print-rx')){
    document.body.classList.remove('print-rx');
  }
  if(autoClearRxAfterPrint){
    autoClearRxAfterPrint = false;
    rxMedications = [];
    renderRxMedTable();
    clearRxDraft();
    showToast('វេជ្ជបញ្ជាបានបោះពុម្ព ត្រៀមសម្រាប់ថ្នាំបន្ទាប់', 'info');
  }
});

(async function init(){
  document.getElementById('invDate').value = new Date().toISOString().slice(0,10);
  await loadSettings();
  await loadDiscountPref();
  await loadPresetServices();
  await loadInvoiceIndex();
  document.getElementById('invoiceNo').value = await peekInvoiceNo();
  applyHistoryFilters();
  renderTeeth();
  renderRows();
})();



/* ============ DASHBOARD (ស្ថិតិប្រចាំខែ) ============ */
const DASH_MONTHS = ["មករា","កុម្ភៈ","មីនា","មេសា","ឧសភា","មិថុនា","កក្កដា","សីហា","កញ្ញា","តុលា","វិច្ឆិកា","ធ្នូ"];
let dashData = null;   // [{key,date,month,day,paid}] មួយ invoice ក្នុងមួយជួរ
let dashMonth = null;  // 'YYYY-MM'

function dashMonthLabel(m){ const p = m.split('-'); return DASH_MONTHS[+p[1]-1] + ' ' + p[0]; }
function dashMoney(n){ return '$' + (Math.round(n*100)/100).toLocaleString('en-US', {maximumFractionDigits:2}); }
function dashShift(m, delta){
  const p = m.split('-').map(Number), d = new Date(p[0], p[1]-1+delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function dashNowMonth(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }

// invoice មួយ => អ្នកជំងឺ (តាមឈ្មោះ), កាលបរិច្ឆេទ, ប្រាក់បានបង់ជា USD
function dashFromRecord(r){
  const name = (r.fullName || ((r.surname||'') + ' ' + (r.givenName||''))).trim().toLowerCase().replace(/\s+/g,' ');
  const date = r.date || (r.savedAt||'').slice(0,10);
  if(!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rate = parseFloat(settings.exRate) || 4100;
  const raw = parseFloat(r.depositValue) || 0;
  let total = parseFloat(r.total);
  if(!isFinite(total)){
    const sub = (r.rows||[]).reduce((s,x) => s + (x.qty||0)*(x.price||0), 0), dv = parseFloat(r.discountValue)||0;
    total = Math.max(0, sub - ((r.discountType||'percent')==='percent' ? sub*dv/100 : dv));
  }
  return { id:r._id, pid:r.patientId||'', key:r.patientId||name, name, phone:r.patientPhone||'', invoiceNo:r.invoiceNo||'',
    date, month:date.slice(0,7), day:+date.slice(8,10), year:+date.slice(0,4),
    paid: r.depositCurrency==='khr' ? raw/rate : raw, total, rows:r.rows||[] };
}

/* ---------- shared data: patients + invoices ---------- */
const FS_URL = "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
let dbPatients = [], dbInvoices = [], dbAppointments = [], clinicLoaded = false, clinicStale = false, appointmentsLoaded = false;
function nameKey(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
function digitsOf(s){ return (s||'').replace(/\D/g,''); }
// ឈ្មោះដូចគ្នា ហើយលេខទូរស័ព្ទដូចគ្នា (ឬម្ខាងមិនមាន) => មនុស្សតែម្នាក់
function matchPatient(name, phone){
  const nk = nameKey(name), ph = digitsOf(phone);
  return dbPatients.find(p => nameKey(p.name)===nk && (!ph || !digitsOf(p.phone) || digitsOf(p.phone)===ph)) || null;
}
function renderPatientSelectors(){
  const patients = dbPatients.slice().sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));
  const invoiceSelect = document.getElementById('invoicePatientSelect');
  if(invoiceSelect){
    const selected = activePatientId;
    invoiceSelect.innerHTML = '<option value="">＋ បញ្ចូលអ្នកជំងឺថ្មី</option>' + patients.map(p =>
      '<option value="'+esc(p.id)+'">'+esc(p.id)+' · '+esc(p.name||'')+'</option>'
    ).join('');
    invoiceSelect.value = selected;
  }
  const appointmentSelect = document.getElementById('appointmentPatient');
  if(appointmentSelect){
    const selected = appointmentSelect.value;
    appointmentSelect.innerHTML = '<option value="">ជ្រើសរើសអ្នកជំងឺ</option>' + patients.map(p =>
      '<option value="'+esc(p.id)+'">'+esc(p.id)+' · '+esc(p.name||'')+'</option>'
    ).join('');
    appointmentSelect.value = selected;
  }
}
async function loadClinicData(force){
  if(clinicLoaded && !force && !clinicStale) return;
  const { collection, getDocs } = await import(FS_URL);
  const db = await getFbDb();
  const res = await Promise.all([getDocs(collection(db,'patients')), getDocs(collection(db,'invoices'))]);
  dbPatients = res[0].docs.map(d => Object.assign({}, d.data(), {id:d.id}));
  dbInvoices = res[1].docs.map(d => Object.assign({}, d.data(), {_id:d.id}));
  renderPatientSelectors();
  dashData = dbInvoices.map(dashFromRecord).filter(Boolean);
  dashData.forEach(x => { if(!x.pid){ const p = matchPatient(x.name, x.phone); if(p){ x.pid = p.id; x.key = p.id; } } });
  clinicLoaded = true; clinicStale = false;
}
function nextPatientId(){
  let max = 0;
  dbPatients.forEach(p => { const n = parseInt(String(p.id).replace(/\D/g,''),10); if(n > max) max = n; });
  return 'P-' + String(max+1).padStart(4,'0');
}
async function ensurePatient(name, phone, gender, age, photo){
  if(!(name||'').trim()) return '';
  await loadClinicData();
  const found = matchPatient(name, phone);
  if(found) return found.id;
  const { doc, setDoc } = await import(FS_URL);
  const db = await getFbDb(), id = nextPatientId();
  const rec = { id, name:name.trim(), phone:(phone||'').trim(), gender:gender||'', age:age||'', photo:photo||'', createdAt:new Date().toISOString() };
  await setDoc(doc(db,'patients',id), rec);
  dbPatients.push(rec);
  renderPatientSelectors();
  return id;
}

async function loadDashboard(force){
  const body = document.getElementById('dashBody');
  if(!dashData || force || clinicStale){
    body.innerHTML = '<div class="history-empty">កំពុងទាញទិន្នន័យ...</div>';
    try{ await loadClinicData(true); }
    catch(e){ console.error('Dashboard:', e); body.innerHTML = '<div class="history-empty">មិនអាចទាញទិន្នន័យបានទេ</div>'; return; }
  }
  if(!dashMonth) dashMonth = dashNowMonth();
  renderDashboard();
}
async function loadInvoicePatientOptions(){
  try{
    await loadClinicData();
    renderPatientSelectors();
  }catch(e){
    console.error('Invoice patient list:',e);
    showToast('មិនអាចទាញបញ្ជីអ្នកជំងឺបានទេ', 'error');
  }
}
const DASH_PATH = {
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  plus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  check:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  wallet:'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  receipt:'<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  coin:'<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
};
function dashSvg(k){ return '<svg class="dash-ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + DASH_PATH[k] + '</svg>'; }
function dashTotalBanner(){
  const ids = new Set(dashData.map(x => x.key).concat(dbPatients.map(p => p.id)));
  return '<button class="dash-total" type="button" onclick="openPatientQuickActions()" aria-label="បើកជម្រើសអ្នកជំងឺ">' + dashSvg('users') + '<span><span class="dl">Patient ID សរុបទាំងអស់</span><span class="dv">' + ids.size + ' នាក់</span></span><span class="dk">ចុចទីនេះ ដើម្បីជ្រើសអ្នកជំងឺចាស់<br>ឬបន្ថែមអ្នកជំងឺថ្មី</span></button>';
}
function openPatientQuickActions(){
  openModal(
    '<div class="modal-header"><div><h3>ជ្រើសរើសអ្នកជំងឺ</h3><div class="modal-subtitle">តើអ្នកចង់បន្តជាមួយអ្នកជំងឺចាស់ ឬបន្ថែមអ្នកជំងឺថ្មី?</div></div><button class="modal-close" onclick="closeModal()">✕</button></div>'+
    '<div class="modal-body"><div class="patient-quick-actions">'+
    '<button class="patient-quick-action" type="button" onclick="openPatientsPage(\'existing\')"><span class="patient-quick-action-icon">👤</span><span><strong>អ្នកជំងឺចាស់</strong><small>ស្វែងរក និងបើកប្រវត្តិអ្នកជំងឺ</small></span></button>'+
    '<button class="patient-quick-action" type="button" onclick="openPatientsPage(\'new\')"><span class="patient-quick-action-icon">＋</span><span><strong>អ្នកជំងឺថ្មី</strong><small>បញ្ចូលព័ត៌មាន និងបង្កើត Patient ID</small></span></button>'+
    '</div></div>',
    'detail-modal'
  );
}
function openPatientsPage(mode){
  closeModal();
  switchView('patients');
  setTimeout(()=>{
    const target = document.getElementById(mode==='new' ? 'ptName' : 'ptSearch');
    if(target){
      target.scrollIntoView({behavior:'smooth',block:'center'});
      target.focus();
    }
  },200);
}
function dashSelect(m){ dashMonth = m; renderDashboard(); }

function dashStats(m, first){
  const list = dashData.filter(x => x.month === m);
  const pats = new Set(list.map(x => x.key));
  let nw = 0; pats.forEach(k => { if(first[k].slice(0,7) === m) nw++; });
  const days = {}; let rev = 0;
  list.forEach(x => { rev += x.paid; days[x.day] = (days[x.day]||0) + x.paid; });
  return { total:pats.size, nw, old:pats.size-nw, rev, days };
}
function dashDelta(a, b){
  if(b === undefined || b === null) return '';
  if(b === 0) return a > 0 ? '<span class="dash-up">▲ ថ្មី</span>' : '';
  const p = Math.round((a-b)/b*100);
  return '<span class="' + (p>=0?'dash-up':'dash-dn') + '">' + (p>=0?'▲ ':'▼ ') + Math.abs(p) + '%</span> ធៀបខែមុន';
}
function dashBars(vals, labels, hi, sel, clickable, W, H){
  W = W || 640; H = H || 210;
  const L=34, B=24, T=12, n=vals.length, max=Math.max.apply(null, vals.concat([1])), bw=(W-L)/n, ch=H-B-T;
  let o = '<svg viewBox="0 0 '+W+' '+H+'" role="img">';
  for(let g=0; g<=3; g++){
    const y = T + ch - ch*g/3;
    o += '<line x1="'+L+'" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="#e3e8e7"/><text x="'+(L-5)+'" y="'+(y+3)+'" text-anchor="end">'+Math.round(max*g/3)+'</text>';
  }
  vals.forEach((v,i) => {
    const h = ch*v/max, x = L + i*bw + bw*.15;
    o += '<rect class="dash-bar'+(i===hi?' hi':'')+(i===sel?' sel':'')+'" x="'+x+'" y="'+(T+ch-h)+'" width="'+(bw*.7)+'" height="'+h+'" rx="3"'+(clickable?' data-m="'+i+'" style="cursor:pointer"':'')+'><title>'+labels[i]+': '+dashMoney(v)+'</title></rect>';
    if(n<=12 || i%5===0 || i===n-1) o += '<text x="'+(x+bw*.35)+'" y="'+(H-7)+'" text-anchor="middle">'+labels[i]+'</text>';
  });
  return o + '</svg>';
}

function renderDashboard(){
  const body = document.getElementById('dashBody'), sel = document.getElementById('dashMonth');
  const first = {};
  dashData.forEach(x => { if(!(x.key in first) || x.date < first[x.key]) first[x.key] = x.date; });

  // បញ្ជីខែ៖ ពីខែដំបូងបំផុតដែលមានទិន្នន័យ ដល់ខែបច្ចុប្បន្ន
  const nowM = dashNowMonth();
  const months = dashData.map(x => x.month).concat([nowM, dashMonth]).sort();
  const lo = months[0], hi = months[months.length-1], list = [];
  for(let m = lo; m <= hi; m = dashShift(m, 1)) list.push(m);
  sel.innerHTML = list.slice().reverse().map(m => '<option value="'+m+'"'+(m===dashMonth?' selected':'')+'>'+dashMonthLabel(m)+'</option>').join('');

  const S = dashStats(dashMonth, first);
  const P = dashMonth > lo ? dashStats(dashShift(dashMonth,-1), first) : null;
  const rate = parseFloat(settings.exRate) || 4100;
  const IC = {
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    plus:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    check:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
    wallet:'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>'
  };
  // [class, icon, label, value, previous-month value, description]
  const cards = [
    ['', 'users', 'អ្នកជំងឺសរុប', S.total, P && P.total, 'អ្នកជំងឺមិនស្ទួន'],
    ['blue', 'plus', 'អ្នកជំងឺថ្មី', S.nw, P && P.nw, 'មកព្យាបាលលើកដំបូង'],
    ['amber', 'check', 'អ្នកជំងឺត្រឡប់មកវិញ', S.old, P && P.old, 'ធ្លាប់មកព្យាបាលពីមុន'],
    ['green', 'wallet', 'ប្រាក់បានទទួល', dashMoney(S.rev), P && P.rev, 'គណនាតាមការទូទាត់ · ≈ ' + Math.round(S.rev*rate).toLocaleString('en-US') + ' ៛']
  ];
  const cardHtml = cards.map((c, i) => {
    const cur = i === 3 ? S.rev : c[3];
    return '<div class="dash-card ' + c[0] + '">' +
      '<svg class="dash-ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[c[1]] + '</svg>' +
      '<div class="dl">' + c[2] + '</div><div class="dv">' + c[3] + '</div><div class="dk">' + c[5] + '</div>' +
      '<div class="dd">' + dashDelta(cur, c[4]) + '</div></div>';
  }).join('');

  const p = dashMonth.split('-'), nd = new Date(+p[0], +p[1], 0).getDate();
  const dv = []; for(let d=1; d<=nd; d++) dv.push(S.days[d] || 0);
  const dmax = Math.max.apply(null, dv), dhi = dmax > 0 ? dv.indexOf(dmax) : -1;
  const dsub = dhi >= 0 ? 'ថ្ងៃដែលទទួលបានច្រើនជាងគេ៖ ថ្ងៃទី '+(dhi+1)+' ('+dashMoney(dmax)+')' : 'មិនទាន់មានប្រាក់ចូលក្នុងខែនេះ';

  const ms = list.slice(-12), mv = ms.map(m => dashStats(m, first).rev);
  const mmax = Math.max.apply(null, mv), mhi = mmax > 0 ? mv.indexOf(mmax) : -1;

  body.innerHTML =
    dashTotalBanner() + '<div class="dash-cards">' + cardHtml + '</div>' +
    '<div class="dash-row"><div class="dash-panel"><h3>ប្រាក់ចំណូលតាមថ្ងៃ</h3><div class="ds">'+dsub+'</div>' + dashBars(dv, dv.map((_,i)=>i+1), dhi, -1, false) + '</div>' +
    '<div class="dash-panel"><h3>ប្រាក់ចំណូលតាមខែ</h3><div class="ds">ចុចលើខែណាមួយ ដើម្បីប្រៀបធៀប</div>' + dashBars(mv, ms.map(m => DASH_MONTHS[+m.slice(5)-1]), mhi, ms.indexOf(dashMonth), true, 380, 240) + '</div></div>' +
    '<div class="dash-note">អ្នកជំងឺរាប់តាមឈ្មោះក្នុងវិក្កយបត្រ។ ប្រាក់ទទួលគិតតាម «ប្រាក់កក់/បានបង់» ក្នុងវិក្កយបត្រនីមួយៗ ដាក់តាមកាលបរិច្ឆេទវិក្កយបត្រ ហើយបម្លែងរៀលជាដុល្លារតាមអត្រា '+Math.round(rate).toLocaleString('en-US')+' ៛។</div>';
  body.querySelectorAll('rect[data-m]').forEach(r => r.onclick = () => dashSelect(ms[+r.dataset.m]));
}

document.addEventListener('DOMContentLoaded', () => { loadDashboard(); });


/* ============ PATIENT MANAGEMENT ============ */
function ptStats(){
  const st = {};
  dashData.forEach(x => { const s = st[x.key] || (st[x.key] = {n:0, paid:0, total:0}); s.n++; s.paid += x.paid; s.total += x.total; });
  return st;
}
async function loadPatientsView(force){
  const list = document.getElementById('ptList');
  if(!clinicLoaded || force || clinicStale){
    list.innerHTML = '<div class="history-empty">កំពុងទាញទិន្នន័យ...</div>';
    try{ await loadClinicData(true); }
    catch(e){ console.error(e); list.innerHTML = '<div class="history-empty">មិនអាចទាញទិន្នន័យបានទេ</div>'; return; }
  }
  renderPatients();
}
function renderPatients(){
  if(!clinicLoaded) return;
  const q = nameKey(document.getElementById('ptSearch').value), qd = digitsOf(q), st = ptStats();
  document.getElementById('ptTotal').textContent = new Set(dashData.map(x => x.key).concat(dbPatients.map(p => p.id))).size;
  const orphan = new Set(dashData.filter(x => !x.pid).map(x => x.key)).size;
  document.getElementById('ptNotice').innerHTML = orphan ? '<div class="pt-notice"><span>មានអ្នកជំងឺ '+orphan+' នាក់ក្នុងវិក្កយបត្រចាស់ ដែលមិនទាន់មាន Patient ID</span><button class="btn btn-primary" type="button" onclick="backfillPatients()">🔗 បង្កើត ID ឱ្យពួកគេ</button></div>' : '';
  const rows = dbPatients.filter(p => !q || nameKey(p.name).includes(q) || String(p.id).toLowerCase().includes(q) || (qd && digitsOf(p.phone).includes(qd)))
    .sort((a,b) => String(b.id).localeCompare(String(a.id)));
  document.getElementById('ptList').innerHTML = rows.length ? rows.map(p => {
    const s = st[p.id] || {n:0, paid:0};
    const avatar = p.photo ? '<img class="pt-avatar-photo" src="'+esc(p.photo)+'" alt="">' : esc((p.name||'?').charAt(0).toUpperCase());
    return '<div class="history-item pt-row" onclick="openPatientDetail(\''+esc(p.id)+'\')"><div class="history-item-left"><div class="history-avatar">'+avatar+'</div><div class="history-item-info"><div class="hi-name">'+esc(p.name)+'</div><div class="hi-meta"><span class="pt-id">'+esc(p.id)+'</span> '+esc(p.phone||'—')+(p.gender?' · '+esc(p.gender):'')+(p.age?' · '+esc(String(p.age))+' ឆ្នាំ':'')+'</div></div></div><div class="history-item-right"><div class="hi-meta">'+s.n+' ដង · '+dashMoney(s.paid)+'</div><button class="history-del-btn" type="button" title="លុបអ្នកជំងឺ" aria-label="លុបអ្នកជំងឺ" onclick="event.stopPropagation(); deletePatient(\''+esc(p.id)+'\')">🗑️</button></div></div>';
  }).join('') : '<div class="history-empty">រកមិនឃើញអ្នកជំងឺទេ</div>';
}
function previewPatientPhoto(input){
  const preview = document.getElementById('ptPhotoPreview');
  const file = input.files && input.files[0];
  if(!file){ preview.hidden = true; preview.removeAttribute('src'); return; }
  if(!file.type.startsWith('image/') || file.size > 450 * 1024){
    input.value = '';
    preview.hidden = true;
    preview.removeAttribute('src');
    showToast('សូមជ្រើសរូបភាពដែលមានទំហំមិនលើស 450 KB', 'error');
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
}
function readPatientPhoto(file){
  if(!file) return Promise.resolve('');
  if(!file.type.startsWith('image/') || file.size > 450 * 1024){
    return Promise.reject(new Error('រូបភាពត្រូវមានទំហំមិនលើស 450 KB'));
  }
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result||''));
    reader.onerror = () => reject(new Error('មិនអាចអានឯកសាររូបភាពបានទេ'));
    reader.readAsDataURL(file);
  });
}
async function updatePatientPhoto(id,input){
  const patient = dbPatients.find(p => p.id===id);
  if(!patient) return;
  try{
    const photo = await readPatientPhoto(input.files && input.files[0]);
    if(!photo) return;
    const { doc, updateDoc } = await import(FS_URL);
    const db = await getFbDb();
    await updateDoc(doc(db,'patients',id), {photo});
    patient.photo = photo;
    renderPatients();
    openPatientDetail(id);
    showToast('បានធ្វើបច្ចុប្បន្នភាពរូបអ្នកជំងឺ', 'success');
  }catch(e){
    console.error('Patient photo:',e);
    showToast('មិនអាចរក្សាទុករូបបានទេ៖ '+(e.message||'សូមពិនិត្យ Firestore Rules'), 'error');
  }
}
async function addPatientManual(){
  const g = id => document.getElementById(id);
  const name = g('ptName').value.trim();
  if(!name){ showToast('សូមបញ្ចូលឈ្មោះអ្នកជំងឺ', 'error'); return; }
  try{
    await loadClinicData();
    const ex = matchPatient(name, g('ptPhone').value);
    if(ex){ showToast('មានអ្នកជំងឺនេះរួចហើយ៖ ' + ex.id, 'error'); return; }
    const photo = await readPatientPhoto(g('ptPhoto').files[0]);
    const id = await ensurePatient(name, g('ptPhone').value, g('ptGender').value, g('ptAge').value, photo);
    ['ptName','ptPhone','ptGender','ptAge','ptPhoto'].forEach(k => g(k).value = '');
    g('ptPhotoPreview').hidden = true;
    g('ptPhotoPreview').removeAttribute('src');
    renderPatients();
    renderPatientSelectors();
    showToast('បានបង្កើត Patient ID ' + id, 'success');
  }catch(e){ console.error(e); showToast('រក្សាទុកមិនបានទេ៖ '+(e.message||'សូមពិនិត្យ Firestore Rules'), 'error'); }
}
async function loadAppointments(force){
  if(appointmentsLoaded && !force) return;
  const { collection, getDocs } = await import(FS_URL);
  const db = await getFbDb();
  const snap = await getDocs(collection(db,'appointments'));
  dbAppointments = snap.docs.map(d => Object.assign({}, d.data(), {id:d.id}));
  appointmentsLoaded = true;
}
function appointmentStatusLabel(status){
  return status==='completed' ? 'បានមកព្យាបាល' : status==='cancelled' ? 'បានលុបចោល' : 'បានកំណត់';
}
function renderAppointments(){
  const list = document.getElementById('appointmentList');
  const records = dbAppointments.slice().sort((a,b) => String(b.dateTime||'').localeCompare(String(a.dateTime||'')));
  list.innerHTML = records.length ? records.map(a => {
    const patient = dbPatients.find(p => p.id===a.patientId);
    const date = a.dateTime ? a.dateTime.replace('T',' ') : '—';
    return '<div class="history-item"><div class="history-item-info"><div class="hi-name">'+esc(patient ? patient.name : a.patientName||'អ្នកជំងឺ')+' <span class="pt-id">'+esc(a.patientId||'')+'</span></div><div class="hi-meta">'+esc(date)+' · '+esc(a.treatment||'—')+' · '+esc(a.doctor||'—')+'</div><div class="hi-meta">'+esc(a.notes||'')+'</div></div><div class="history-item-right"><span class="appointment-status">'+esc(appointmentStatusLabel(a.status))+'</span><button class="history-del-btn" type="button" title="លុបការណាត់ជួប" aria-label="លុបការណាត់ជួប" onclick="deleteAppointment(\''+esc(a.id)+'\')">🗑️</button></div></div>';
  }).join('') : '<div class="history-empty">មិនទាន់មានការណាត់ជួប</div>';
}
async function loadAppointmentsView(){
  const list = document.getElementById('appointmentList');
  const notice = document.getElementById('appointmentNotice');
  list.innerHTML = '<div class="history-empty">កំពុងទាញទិន្នន័យ...</div>';
  notice.innerHTML = '';
  try{
    await loadClinicData();
    renderPatientSelectors();
    await loadAppointments(true);
    renderAppointments();
  }catch(e){
    console.error('Appointments:', e);
    list.innerHTML = '<div class="history-empty">មិនអាចទាញការណាត់ជួបបានទេ</div>';
    notice.innerHTML = '<div class="pt-notice">សូមពិនិត្យការតភ្ជាប់ និង Firestore Rules សម្រាប់ appointments។</div>';
  }
}
async function saveAppointment(){
  const patientId = document.getElementById('appointmentPatient').value;
  const patient = dbPatients.find(p => p.id===patientId);
  const dateTime = document.getElementById('appointmentDate').value;
  const treatment = document.getElementById('appointmentTreatment').value.trim();
  if(!patient){ showToast('សូមជ្រើសរើសអ្នកជំងឺដែលមាន Patient ID', 'error'); return; }
  if(!dateTime || !treatment){ showToast('សូមបញ្ចូលថ្ងៃ និងសេវាកម្មព្យាបាល', 'error'); return; }
  const appointmentMinutes = Number(dateTime.slice(11,13))*60 + Number(dateTime.slice(14,16));
  const openingParts = (settings.appointmentStartTime||'08:00').split(':').map(Number);
  const closingParts = (settings.appointmentEndTime||'17:00').split(':').map(Number);
  const openingMinutes = openingParts[0]*60 + openingParts[1];
  const closingMinutes = closingParts[0]*60 + closingParts[1];
  const duration = Number(settings.appointmentDuration)||30;
  if(!Number.isFinite(appointmentMinutes) || appointmentMinutes < openingMinutes || appointmentMinutes + duration > closingMinutes){
    showToast('ពេលណាត់ត្រូវនៅចន្លោះម៉ោង '+settings.appointmentStartTime+'–'+settings.appointmentEndTime+' និងគ្រប់គ្រាន់សម្រាប់រយៈពេល '+duration+' នាទី', 'error');
    return;
  }
  const record = {
    patientId, patientName:patient.name, dateTime,
    duration,
    doctor:document.getElementById('appointmentDoctor').value.trim(),
    treatment,
    status:document.getElementById('appointmentStatus').value,
    notes:document.getElementById('appointmentNotes').value.trim(),
    savedAt:new Date().toISOString()
  };
  try{
    const { collection, doc, setDoc } = await import(FS_URL);
    const db = await getFbDb();
    const ref = doc(collection(db,'appointments'));
    const id = ref.id;
    await setDoc(ref, Object.assign({id},record));
    dbAppointments.push(Object.assign({id},record));
    ['appointmentDate','appointmentDoctor','appointmentTreatment','appointmentNotes'].forEach(field => document.getElementById(field).value='');
    document.getElementById('appointmentStatus').value='scheduled';
    renderAppointments();
    showToast('បានរក្សាទុកការណាត់ជួប និងភ្ជាប់ទៅ '+patientId, 'success');
  }catch(e){
    console.error('Save appointment:',e);
    showToast('មិនអាចរក្សាទុកការណាត់ជួបបានទេ។ សូមពិនិត្យ Firestore Rules។', 'error');
  }
}
async function deleteAppointment(id){
  const appointment = dbAppointments.find(item => item.id===id);
  if(!appointment) return;
  const patient = dbPatients.find(item => item.id===appointment.patientId);
  const date = String(appointment.dateTime||'').replace('T',' ');
  const ok = await showConfirm('លុបការណាត់ជួបរបស់ '+(patient ? patient.name : appointment.patientName||'អ្នកជំងឺ')+' ថ្ងៃ '+(date||'—')+' មែនទេ? ការធ្វើនេះមិនអាចត្រឡប់វិញបានទេ។', {icon:'🗑️', okLabel:'លុប'});
  if(!ok) return;
  try{
    const { deleteDoc, doc } = await import(FS_URL);
    const db = await getFbDb();
    await deleteDoc(doc(db,'appointments',id));
    dbAppointments = dbAppointments.filter(item => item.id!==id);
    renderAppointments();
    showToast('បានលុបការណាត់ជួប', 'success');
  }catch(e){
    console.error('Delete appointment:',e);
    showToast('មិនអាចលុបការណាត់ជួបបានទេ។ សូមពិនិត្យ Firestore Rules។', 'error');
  }
}
async function deletePatient(id){
  const patient = dbPatients.find(item => item.id===id);
  if(!patient) return;
  try{
    await loadClinicData(true);
    await loadAppointments(true);
    const linkedInvoices = dbInvoices.filter(invoice => invoice.patientId===id).length ||
      dashData.filter(invoice => invoice.key===id).length;
    const linkedAppointments = dbAppointments.filter(appointment => appointment.patientId===id).length;
    if(linkedInvoices || linkedAppointments){
      const reasons = [];
      if(linkedInvoices) reasons.push(linkedInvoices+' វិក្កយបត្រ/ប្រវត្តិព្យាបាល');
      if(linkedAppointments) reasons.push(linkedAppointments+' ការណាត់ជួប');
      showToast('មិនអាចលុបអ្នកជំងឺនេះបានទេ ព្រោះនៅមាន '+reasons.join(' និង ')+'។ សូមលុបការណាត់ជួបជាមុន។ ប្រវត្តិវិក្កយបត្រត្រូវបានរក្សាទុក។', 'error');
      renderPatients();
      return;
    }
    const ok = await showConfirm('លុបអ្នកជំងឺ '+patient.name+' ('+id+') មែនទេ? ការធ្វើនេះមិនអាចត្រឡប់វិញបានទេ។', {icon:'🗑️', okLabel:'លុប'});
    if(!ok) return;
    const { deleteDoc, doc } = await import(FS_URL);
    const db = await getFbDb();
    await deleteDoc(doc(db,'patients',id));
    dbPatients = dbPatients.filter(item => item.id!==id);
    if(activePatientId===id) clearAllSilent();
    renderPatientSelectors();
    renderPatients();
    const overlay = document.getElementById('activeModalOverlay');
    if(overlay) closeModal();
    showToast('បានលុបអ្នកជំងឺ '+id, 'success');
  }catch(e){
    console.error('Delete patient:',e);
    showToast('មិនអាចលុបអ្នកជំងឺបានទេ។ សូមពិនិត្យការតភ្ជាប់ និង Firestore Rules។', 'error');
  }
}
async function openAppointmentForPatient(id){
  try{
    await loadClinicData();
    renderPatientSelectors();
    closeModal();
    switchView('appointments');
    document.getElementById('appointmentPatient').value = id;
  }catch(e){
    console.error('Open patient appointment:',e);
    showToast('មិនអាចបើកទំព័រណាត់ជួបបានទេ', 'error');
  }
}
async function backfillPatients(){
  const ok = await showConfirm('បង្កើត Patient ID ឱ្យវិក្កយបត្រចាស់ៗ ហើយភ្ជាប់វិក្កយបត្រនីមួយៗទៅ ID? មនុស្សឈ្មោះដូចគ្នានឹងបានតែ ID មួយ។', {icon:'🔗', okLabel:'បង្កើត'});
  if(!ok) return;
  try{
    await loadClinicData(true);
    const { doc, updateDoc } = await import(FS_URL), db = await getFbDb();
    let n = 0;
    const todo = dbInvoices.filter(r => !r.patientId && (r.fullName||'').trim()).sort((a,b) => String(a.date||'').localeCompare(String(b.date||'')));
    for(const r of todo){
      const pid = await ensurePatient(r.fullName, r.patientPhone, r.gender, r.age);
      if(pid){ await updateDoc(doc(db,'invoices',r._id), {patientId:pid}); n++; }
    }
    await loadClinicData(true); renderPatients();
    showToast('បានភ្ជាប់វិក្កយបត្រ ' + n + ' ទៅ Patient ID', 'success');
  }catch(e){ console.error(e); showToast('មានបញ្ហា៖ ' + (e.message||e), 'error'); }
}
async function openPatientDetail(id){
  const p = dbPatients.find(x => x.id === id); if(!p) return;
  let appointmentLoadError = false;
  try{ await loadAppointments(true); }catch(e){ console.error('Patient appointments:',e); appointmentLoadError = true; }
  const inv = dashData.filter(x => x.key === id).sort((a,b) => b.date.localeCompare(a.date));
  const patientAppointments = dbAppointments.filter(a => a.patientId===id).sort((a,b) => String(b.dateTime||'').localeCompare(String(a.dateTime||'')));
  const tot = inv.reduce((s,x) => s + x.total, 0), paid = inv.reduce((s,x) => s + x.paid, 0), bal = inv.reduce((s,x) => s + Math.max(0, x.total - x.paid), 0);
  const trs = inv.length ? inv.map(x => {
    const tr = x.rows.map(r => (r.tooth ? '#' + esc(String(r.tooth)) + ' ' : '') + esc(r.treatment||'')).join(', ') || '—';
    return '<tr><td>'+esc(x.date)+'</td><td>'+esc(String(x.invoiceNo||'—'))+'</td><td class="tr">'+tr+'</td><td class="num">'+dashMoney(x.total)+'</td><td class="num">'+dashMoney(x.paid)+'</td><td class="num">'+dashMoney(Math.max(0,x.total-x.paid))+'</td><td><button class="btn btn-secondary" onclick="closeModal(); loadInvoiceById(\''+esc(x.id)+'\');">បើក</button></td></tr>';
  }).join('') : '<tr><td colspan="7" class="empty-row">មិនទាន់មានវិក្កយបត្រ</td></tr>';
  const appointmentRows = patientAppointments.length ? patientAppointments.map(a =>
    '<tr><td>'+esc(String(a.dateTime||'—').replace('T',' '))+'</td><td>'+esc(a.treatment||'—')+'</td><td>'+esc(a.doctor||'—')+'</td><td>'+esc(appointmentStatusLabel(a.status))+'</td></tr>'
  ).join('') : '<tr><td colspan="4" class="empty-row">'+(appointmentLoadError?'មិនអាចទាញប្រវត្តិការណាត់ជួបបាន':'មិនទាន់មានការណាត់ជួប')+'</td></tr>';
  openModal('<div class="modal-header"><div><h3>'+esc(p.name)+' <span class="pt-id">'+esc(p.id)+'</span></h3><div class="modal-subtitle">'+esc(p.phone||'—')+(p.gender?' · '+esc(p.gender):'')+(p.age?' · '+esc(String(p.age))+' ឆ្នាំ':'')+'</div></div><button class="modal-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body"><p>'+(p.photo?'<img class="pt-profile-photo" src="'+esc(p.photo)+'" alt="រូបអ្នកជំងឺ">':'')+esc(p.name)+' <label class="btn btn-secondary pt-photo-update">រូបភាព<input type="file" accept="image/*" onchange="updatePatientPhoto(\''+esc(id)+'\',this)"></label></p>'+
    '<div class="pt-sum"><div>ចំនួនដងមក<b>'+inv.length+'</b></div><div>សរុបវិក្កយបត្រ<b>'+dashMoney(tot)+'</b></div><div>បានទទួល<b>'+dashMoney(paid)+'</b></div><div>នៅសល់<b>'+dashMoney(bal)+'</b></div></div>' +
    '<h4>ប្រវត្តិការណាត់ជួប / Appointments</h4><div class="pt-tbl-wrap"><table class="items detail-items"><thead><tr><th>ថ្ងៃ និងម៉ោង</th><th>សេវាកម្ម</th><th>គ្រូពេទ្យ</th><th>ស្ថានភាព</th></tr></thead><tbody>'+appointmentRows+'</tbody></table></div>' +
    '<h4>ប្រវត្តិការព្យាបាល និងវិក្កយបត្រ / Treatments &amp; Invoices</h4><div class="pt-tbl-wrap"><table class="items detail-items"><thead><tr><th>កាលបរិច្ឆេទ</th><th>Invoice</th><th>ការព្យាបាល</th><th class="num">សរុប</th><th class="num">បង់</th><th class="num">នៅសល់</th><th></th></tr></thead><tbody>'+trs+'</tbody></table></div></div>' +
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="openAppointmentForPatient(\''+esc(id)+'\')">＋ ណាត់ជួប</button><button class="btn btn-secondary" onclick="closeModal()">បិទ</button></div>', 'detail-modal');
}

/* ============ REPORTS: Patient + Financial Statistics ============ */
let rpMode = 'month', rpInit = false;
const rpEl = id => document.getElementById(id);
function rpSetMode(m){ rpMode = m; renderReports(); }
function rpCard(cls, ic, label, val, sub){
  return '<div class="dash-card '+cls+'">'+dashSvg(ic)+'<div class="dl">'+label+'</div><div class="dv">'+val+'</div><div class="dk">'+sub+'</div></div>';
}
function rpGrouped(A, B, labels, colors, W, H){
  W = W || 640; H = H || 230;
  const L = 36, Bt = 24, T = 12, n = A.length, max = Math.max.apply(null, A.concat(B, [1])), gw = (W-L)/n, ch = H-Bt-T;
  let o = '<svg viewBox="0 0 '+W+' '+H+'" role="img">';
  for(let g=0; g<=3; g++){ const y = T + ch - ch*g/3; o += '<line x1="'+L+'" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="#e3e8e7"/><text x="'+(L-5)+'" y="'+(y+3)+'" text-anchor="end">'+Math.round(max*g/3)+'</text>'; }
  for(let i=0; i<n; i++){
    const x0 = L + i*gw + gw*.1, bw = Math.min(gw*.4, 40);
    [[A[i],colors[0]],[B[i],colors[1]]].forEach((s,k) => { const h = ch*s[0]/max; o += '<rect x="'+(x0+k*bw)+'" y="'+(T+ch-h)+'" width="'+(bw-1)+'" height="'+h+'" rx="2" fill="'+s[1]+'"><title>'+labels[i]+': '+s[0]+'</title></rect>'; });
    if(n<=12 || i%5===0 || i===n-1) o += '<text x="'+(x0+bw)+'" y="'+(H-7)+'" text-anchor="middle">'+labels[i]+'</text>';
  }
  return o + '</svg>';
}
function rpLegend(items){ return '<div class="rp-lg">' + items.map(i => '<span><i style="background:'+i[1]+'"></i>'+i[0]+'</span>').join('') + '</div>'; }

async function loadReports(){
  const body = rpEl('rpBody');
  body.innerHTML = '<div class="history-empty">កំពុងទាញទិន្នន័យ...</div>';
  try{ await loadClinicData(); }
  catch(e){ console.error(e); body.innerHTML = '<div class="history-empty">មិនអាចទាញទិន្នន័យបានទេ</div>'; return; }
  if(!rpInit){
    const now = new Date(), y = now.getFullYear(), mm = String(now.getMonth()+1).padStart(2,'0');
    rpEl('rpDay').value = y+'-'+mm+'-'+String(now.getDate()).padStart(2,'0');
    rpEl('rpMonth').value = y+'-'+mm;
    const y0 = Math.min.apply(null, dashData.map(x => x.year).concat([y]));
    let opts = ''; for(let k=y; k>=y0; k--) opts += '<option value="'+k+'">'+k+'</option>';
    rpEl('rpYear').innerHTML = opts; rpInit = true;
  }
  renderReports();
}
function renderReports(){
  const body = rpEl('rpBody'); if(!dashData) return;
  document.querySelectorAll('#rpMode button').forEach(b => b.classList.toggle('on', b.dataset.m === rpMode));
  rpEl('rpDay').style.display = rpMode==='day' ? '' : 'none';
  rpEl('rpMonth').style.display = rpMode==='month' ? '' : 'none';
  rpEl('rpYear').style.display = rpMode==='year' ? '' : 'none';
  let a, b, year;
  if(rpMode==='day'){ a = b = rpEl('rpDay').value; year = +a.slice(0,4); }
  else if(rpMode==='month'){ const v = rpEl('rpMonth').value; a = v+'-01'; b = v+'-31'; year = +v.slice(0,4); }
  else { year = +rpEl('rpYear').value; a = year+'-01-01'; b = year+'-12-31'; }
  if(!a || !year){ body.innerHTML = '<div class="history-empty">សូមជ្រើសរើសកាលបរិច្ឆេទ</div>'; return; }

  // ----- Patient statistics -----
  const first = {}; dashData.forEach(x => { if(!(x.key in first) || x.date < first[x.key]) first[x.key] = x.date; });
  const inR = dashData.filter(x => x.date >= a && x.date <= b);
  const bi = d => rpMode==='year' ? +d.slice(5,7)-1 : rpMode==='month' ? +d.slice(8,10)-1 : 0;
  const nb = rpMode==='year' ? 12 : rpMode==='month' ? new Date(year, +a.slice(5,7), 0).getDate() : 1;
  const sets = Array.from({length:nb}, () => ({n:new Set(), r:new Set()})), allN = new Set(), allR = new Set();
  inR.forEach(x => {
    const f = first[x.key], isNew = f >= a;
    (isNew ? allN : allR).add(x.key);
    const s = sets[bi(x.date)];
    if(isNew && bi(f) === bi(x.date)) s.n.add(x.key); else s.r.add(x.key);
  });
  const labels = rpMode==='year' ? DASH_MONTHS.map(s => s) : rpMode==='month' ? Array.from({length:nb}, (_,i) => i+1) : [a];
  const pChart = rpGrouped(sets.map(s => s.n.size), sets.map(s => s.r.size), labels, ['#3b82f6','#f59e0b']);

  // ----- Financial statistics -----
  let inv = 0, rec = 0, dep = 0, bal = 0;
  inR.forEach(x => { const rem = Math.max(0, x.total - x.paid); inv += x.total; rec += x.paid; bal += rem; if(x.paid > 0 && rem > 0.004) dep += x.paid; });
  const invM = Array(12).fill(0), recM = Array(12).fill(0), balM = Array(12).fill(0);
  dashData.filter(x => x.year === year).forEach(x => { const i = +x.month.slice(5)-1; invM[i] += x.total; recM[i] += x.paid; balM[i] += Math.max(0, x.total - x.paid); });
  const trs = DASH_MONTHS.map((mn,i) => '<tr><td>'+mn+'</td><td>'+dashMoney(invM[i])+'</td><td>'+dashMoney(recM[i])+'</td><td>'+dashMoney(balM[i])+'</td><td>'+(i ? dashDelta(recM[i], recM[i-1]) : '')+'</td></tr>').join('');

  body.innerHTML =
    '<h3 class="rp-h">Patient Statistics <small>· ស្ថិតិអ្នកជំងឺ</small></h3>' +
    '<div class="dash-cards">' + rpCard('blue','plus','New Patients',allN.size,'អ្នកជំងឺដែលមកលើកដំបូង') + rpCard('amber','check','Returning Patients',allR.size,'មានប្រវត្តិមកមុន ហើយត្រឡប់មកវិញ') + rpCard('','users','សរុបក្នុងអំឡុងនេះ',allN.size+allR.size,'អ្នកជំងឺផ្សេងគ្នា (មិនស្ទួន)') + '</div>' +
    '<div class="dash-panel"><h3>អ្នកជំងឺថ្មី ប្រៀបធៀបអ្នកជំងឺចាស់</h3><div class="ds">ត្រងតាម'+(rpMode==='day'?'ថ្ងៃ':rpMode==='month'?'ខែ':'ឆ្នាំ')+' ដែលបានជ្រើសរើស</div>' + rpLegend([['អ្នកជំងឺថ្មី','#3b82f6'],['អ្នកជំងឺចាស់ត្រឡប់មកវិញ','#f59e0b']]) + pChart + '</div>' +
    '<h3 class="rp-h">Financial Statistics <small>· ស្ថិតិហិរញ្ញវត្ថុ</small></h3>' +
    '<div class="dash-cards">' + rpCard('blue','receipt','ប្រាក់សរុបតាមវិក្កយបត្រ',dashMoney(inv),'ចំនួនវិក្កយបត្រ '+inR.length) + rpCard('green','wallet','ប្រាក់បានទទួលជាក់ស្តែង',dashMoney(rec),'គិតតាមការបង់ពិតប្រាកដ') + rpCard('amber','coin','ប្រាក់កក់',dashMoney(dep),'វិក្កយបត្រដែលបង់មិនទាន់គ្រប់') + rpCard('','clock','ប្រាក់នៅសល់',dashMoney(bal),'មិនទាន់បានបង់') + '</div>' +
    '<div class="dash-panel"><h3>ប្រៀបធៀបចំណូលតាមខែ · '+year+'</h3><div class="ds">សរុបវិក្កយបត្រ ធៀបនឹងប្រាក់បានទទួល</div>' + rpLegend([['សរុបវិក្កយបត្រ','#3b82f6'],['ប្រាក់បានទទួល','#28a99e']]) + rpGrouped(invM, recM, DASH_MONTHS, ['#3b82f6','#28a99e']) +
    '<div class="pt-tbl-wrap"><table class="rp-tbl"><thead><tr><th>ខែ</th><th>សរុបវិក្កយបត្រ</th><th>បានទទួល</th><th>នៅសល់</th><th>បានទទួលធៀបខែមុន</th></tr></thead><tbody>'+trs+'</tbody></table></div></div>' +
    '<p class="dash-note">ប្រាក់កក់ = ប្រាក់បានបង់នៃវិក្កយបត្រដែលបង់មិនទាន់គ្រប់។ ប្រាក់នៅសល់ = សរុបវិក្កយបត្រ − ប្រាក់បានបង់។ ប្រាក់ដាក់តាមកាលបរិច្ឆេទវិក្កយបត្រ។</p>';
}