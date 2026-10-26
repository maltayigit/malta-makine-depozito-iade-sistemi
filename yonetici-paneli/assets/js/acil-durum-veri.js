/* ============================================================
   ACİL DURUM IŞIĞI & ALARM SİSTEMİ VERİ KAYNAĞI — acil-durum-veri.js
   ============================================================
   Amaç: Makine üzerindeki fiziksel acil durum ışığının (döner far /
   sinyal lambası) ve sesli alarmın anlık durumunu tek bir merkezde
   toplamak. Diğer alt sistemler (ezme üniteleri, cam kırma, su
   karıştırma, motor, doluluk, kamera, ekran paneli vb.) bir sorun
   tespit ettiğinde bu dosyadaki tek bir fonksiyonu çağırarak alarm
   kaydı düşer:

        acilDurumAlarmVer(kaynakAdi, seviye, mesaj);

   'seviye' şu üç değerden biri olmalıdır: 'kritik' | 'uyari' | 'bilgi'
   Örnek:
        acilDurumAlarmVer('1. Plastik Ezme Ünitesi', 'kritik',
                           'Sıkışma algılandı, motor durduruldu.');

   Bu dosyayı başka bir sayfaya eklemek için (kayıt DÜŞMEK isteyen
   her sayfaya, örn. ezme1.html, cam-kirma.html vb.):
        <script src="acil-durum-veri.js"></script>
   ve sıkışma/arıza tespit edildiği yerde yukarıdaki fonksiyonu
   çağırmanız yeterlidir. acil-durum.html sayfası tüm kayıtları
   localStorage üzerinden okuyup listeler, en yüksek seviyeye göre
   ışığın rengini belirler ve sesli alarmı çalar.

   ÖNEMLİ — GERÇEK DONANIM ENTEGRASYONU:
   Şu an "Demo Modu" (aşağıda) rastgele örnek alarmlar üretir; bu
   yalnızca ekranın nasıl görüneceğini göstermek içindir. Gerçek
   kurulumda:
     1) Demo Modu kapatılmalı (acil-durum.html sayfasındaki anahtar).
     2) Fiziksel acil durum ışığı/sireni bir PLC, röle kartı ya da
        GPIO girişine bağlanmalı; bu girişin durumu okunduğunda
        (örn. küçük bir yerel servis / API üzerinden) doğrudan
        acilDurumAlarmVer(...) çağrılmalı, rastgele üretim yerine.
     3) Aynı şekilde diğer alt sistemlerin (ezme-veri.js, doluluk-veri.js
        vb. gerçek sıkışma/arıza tespitleri) bu fonksiyonu çağıracak
        şekilde küçük birer satırla genişletilmesi yeterlidir.
   ============================================================ */

const ACIL_KAYIT_KEY   = 'acilDurumKayitlari';   // Tüm alarm kayıtları (dizi)
const ACIL_SES_KEY     = 'acilDurumSesKapali';   // Sesli alarm kapalı mı?
const ACIL_DEMO_KEY    = 'acilDurumDemoModu';    // Demo modu açık mı?
const ACIL_MAX_KAYIT   = 200;                    // Geçmişte tutulacak azami kayıt

const ACIL_SEVIYE_SIRA  = { kritik: 3, uyari: 2, bilgi: 1 };
const ACIL_SEVIYE_METIN = { kritik: 'Kritik Alarm', uyari: 'Uyarı', bilgi: 'Bilgi' };

/* ── Depo okuma/yazma ── */
function acilDurumKayitlariYukle(){
  try { return JSON.parse(localStorage.getItem(ACIL_KAYIT_KEY) || '[]'); }
  catch(e){ return []; }
}
function acilDurumKayitlariKaydet(liste){
  try { localStorage.setItem(ACIL_KAYIT_KEY, JSON.stringify(liste)); }
  catch(e){ /* sessizce geç */ }
}

function acilDurumIdUret(){
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ── Yeni bir alarm kaydı düşer. Diğer tüm sayfalar bunu çağırır. ── */
function acilDurumAlarmVer(kaynak, seviye, mesaj){
  if (!ACIL_SEVIYE_SIRA[seviye]) seviye = 'uyari';
  const liste = acilDurumKayitlariYukle();
  const kayit = {
    id: acilDurumIdUret(),
    kaynak: kaynak || 'Bilinmeyen Kaynak',
    seviye: seviye,
    mesaj: mesaj || '',
    zaman: Date.now(),
    onaylandi: false,
    giderildi: false,
    giderilmeZamani: null,
    backendFaultId: null   // /api/faults'a yazılan karşılık gelen arıza kaydının id'si (varsa)
  };
  liste.unshift(kayit);
  if (liste.length > ACIL_MAX_KAYIT) liste.length = ACIL_MAX_KAYIT;
  acilDurumKayitlariKaydet(liste);
  _acilDurumBackendeBildir(kayit);
  return kayit;
}

/* Kritik ve uyarı seviyesindeki alarmları, ilgili makinenin backend'deki
   arıza (fault) kaydı olarak da düşürür. Böylece makineler.html'deki
   "ARIZA VAR" rozeti ve m.ariza/m.arizaAciklama alanları (makine-veri.js)
   acil durum panelindeki alarmlarla senkron kalır.

   'bilgi' seviyesi kasıtlı olarak backend'e yazılmaz — henüz gerçek bir
   arıza sayılmıyor, sadece takip edilmesi gereken bir not.

   ÖNEMLİ: Bu sayfalarda hangi yardımcı script'lerin yüklü olduğu SAYFADAN
   SAYFAYA DEĞİŞİYOR — ör. ezme1-05l.html, simülasyon çakışmasını önlemek
   için doluluk-veri.js'i (aktifMakineIdGetir) ve makine-veri.js'i
   (arizaBildir) KASITLI olarak yüklemiyor, bunun yerine api-client.js
   (window.MaltaApi) kullanıyor. Eskiden bu iki fonksiyon eksikse
   sessizce hiçbir şey yapılmıyordu — yani tam da ezme1-05l.html gibi
   sayfalarda gerçekleşen sıkışmalar backend'e HİÇ yazılmıyordu ve
   makineler.html'de arıza görünmüyordu. Aşağıdaki yardımcılar artık
   önce mevcut fonksiyonu, yoksa api-client.js'i, o da yoksa doğrudan
   fetch ile auth.js'in sağladığı AUTH_API_BASE/oturumAccessTokenGetir'i
   kullanarak backend'e ulaşıyor — hangi sayfada olursak olalım. */
function _acilDurumMakineIdGetir(){
  if (typeof aktifMakineIdGetir === 'function') return aktifMakineIdGetir();
  if (window.MaltaApi && typeof window.MaltaApi.machineId === 'function') {
    var id = window.MaltaApi.machineId();
    if (id) return Promise.resolve(id);
  }
  var kayitli = localStorage.getItem('aktifMakineId');
  if (kayitli) return Promise.resolve(kayitli);
  return Promise.reject(new Error('Aktif makine kimliği bulunamadı (aktifMakineId hiç ayarlanmamış).'));
}

function _acilDurumFetchYedek(yol, secenekler){
  var token = (typeof oturumAccessTokenGetir === 'function') ? oturumAccessTokenGetir() : null;
  var taban = (typeof AUTH_API_BASE !== 'undefined') ? AUTH_API_BASE : '';
  return fetch(taban + yol, Object.assign({}, secenekler, {
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      (secenekler && secenekler.headers) || {}
    )
  })).then(function(res){
    if (res.status === 401) {
      // Access token geçersiz/süresi dolmuş → oturumu kapat, login'e dön.
      if (typeof cikisYap === 'function') cikisYap();
      throw new Error('Oturum geçersiz, tekrar giriş yapmanız gerekiyor.');
    }
    if (res.status === 204) return null;
    return res.json().catch(function(){ return null; }).then(function(veri){
      if (!res.ok) throw new Error((veri && veri.message) || 'İstek başarısız (' + res.status + ')');
      return veri;
    });
  });
}

function _acilDurumArizaBildir(machineId, aciklama){
  if (typeof arizaBildir === 'function') return arizaBildir(machineId, aciklama);
  if (window.MaltaApi && typeof window.MaltaApi.request === 'function') {
    return window.MaltaApi.request('/api/faults', {
      method: 'POST', body: JSON.stringify({ machineId: machineId, faultDescription: aciklama })
    });
  }
  return _acilDurumFetchYedek('/api/faults', {
    method: 'POST', body: JSON.stringify({ machineId: machineId, faultDescription: aciklama })
  });
}

function _acilDurumArizaCozulduBildir(faultId){
  if (typeof arizaCozulduBildir === 'function') return arizaCozulduBildir(faultId);
  if (window.MaltaApi && typeof window.MaltaApi.request === 'function') {
    return window.MaltaApi.request('/api/faults/' + faultId, {
      method: 'PATCH', body: JSON.stringify({ status: 'RESOLVED' })
    });
  }
  return _acilDurumFetchYedek('/api/faults/' + faultId, {
    method: 'PATCH', body: JSON.stringify({ status: 'RESOLVED' })
  });
}

function _acilDurumBackendeBildir(kayit){
  if (kayit.seviye === 'bilgi') return;

  _acilDurumMakineIdGetir()
    .then(function(makineId){ return _acilDurumArizaBildir(makineId, kayit.kaynak + ': ' + kayit.mesaj); })
    .then(function(sonuc){
      var faultId = sonuc && (sonuc.fault_id || sonuc.id || sonuc.faultId ||
        (sonuc.fault && (sonuc.fault.fault_id || sonuc.fault.id)));
      if (faultId){
        var liste = acilDurumKayitlariYukle();
        var guncelKayit = liste.find(function(k){ return k.id === kayit.id; });
        if (guncelKayit){
          guncelKayit.backendFaultId = faultId;
          acilDurumKayitlariKaydet(liste);
          // Yarış durumu: fault_id backend'den dönene kadar geçen sürede
          // alarm zaten yerelde giderilmiş olabilir (backendFaultId o an
          // null olduğu için _acilDurumBackendCozulduBildir o zaman hiçbir
          // şey yapmamıştı). Şimdi id elimize geçtiğine göre, kayıt hâlâ
          // giderilmiş görünüyorsa backend'deki arızayı hemen kapatıyoruz —
          // aksi halde açık kalıp makineyi sonsuza dek "arızalı" gösterirdi.
          if (guncelKayit.giderildi) _acilDurumBackendCozulduBildir(guncelKayit);
        }
      } else {
        console.warn('[acil-durum] Backend arıza yanıtında fault id bulunamadı, gelen yanıt:', sonuc);
      }
    })
    .catch(function(e){
      console.error('[acil-durum] Backend arıza kaydı oluşturulamadı:', e);
    });
}

/* Bir alarma karşılık backend'de açılmış bir arıza kaydı varsa, alarm
   giderildiğinde onu da "RESOLVED" olarak kapatır. */
function _acilDurumBackendCozulduBildir(kayit){
  if (!kayit || !kayit.backendFaultId) return;
  _acilDurumArizaCozulduBildir(kayit.backendFaultId).catch(function(e){
    console.error('[acil-durum] Backend arıza kaydı kapatılamadı:', e);
  });
}


function acilDurumOnayla(id){
  const liste = acilDurumKayitlariYukle();
  const kayit = liste.find(function(k){ return k.id === id; });
  if (kayit) kayit.onaylandi = true;
  acilDurumKayitlariKaydet(liste);
}

function acilDurumGider(id){
  const liste = acilDurumKayitlariYukle();
  const kayit = liste.find(function(k){ return k.id === id; });
  if (kayit){
    kayit.giderildi = true;
    kayit.giderilmeZamani = Date.now();
    _acilDurumBackendCozulduBildir(kayit);
  }
  acilDurumKayitlariKaydet(liste);
}

/* Belirli bir kaynaktan gelen tüm AKTİF alarmları giderilmiş olarak işaretler.
   Bir alt sistem sorunu kendi kendine (örn. "Sıkışmayı Gider" butonuyla)
   çözdüğünde, ilgili sayfa bu fonksiyonu kaynak adıyla çağırarak merkezi
   panelden de aynı alarmı temizleyebilir — tek tek id takip etmeye gerek yok. */
function acilDurumGiderKaynak(kaynak){
  const liste = acilDurumKayitlariYukle();
  const simdi = Date.now();
  let degisti = false;
  liste.forEach(function(k){
    if (!k.giderildi && k.kaynak === kaynak){
      k.giderildi = true;
      k.giderilmeZamani = simdi;
      degisti = true;
      _acilDurumBackendCozulduBildir(k);
    }
  });
  if (degisti) acilDurumKayitlariKaydet(liste);
}

function acilDurumTumunuGider(){
  const liste = acilDurumKayitlariYukle();
  const simdi = Date.now();
  liste.forEach(function(k){
    if (!k.giderildi){
      k.giderildi = true;
      k.giderilmeZamani = simdi;
      _acilDurumBackendCozulduBildir(k);
    }
  });
  acilDurumKayitlariKaydet(liste);
}

function acilDurumAktifler(){
  return acilDurumKayitlariYukle().filter(function(k){ return !k.giderildi; });
}

/* Aktif alarmlar arasında en az bir 'kritik' seviyeli kayıt var mı?
   Ana ekran (index.html) gibi acil-durum.html olmayan sayfalar, kritik bir
   alarm varsa üstte bir uyarı şeridi göstermek isterse bu fonksiyonu (veya
   aşağıdaki acilDurumKritikAktifler() fonksiyonunu) kullanabilir. */
function acilDurumKritikAktiflerVarMi(){
  return acilDurumAktifler().some(function(k){ return k.seviye === 'kritik'; });
}

/* Aktif alarmlar arasındaki tüm 'kritik' seviyeli kayıtları döner. */
function acilDurumKritikAktifler(){
  return acilDurumAktifler().filter(function(k){ return k.seviye === 'kritik'; });
}

/* Aktif kayıtlar içindeki en yüksek seviyeyi döner: 'kritik' | 'uyari' | 'bilgi' | 'normal' */
function acilDurumMevcutSeviye(){
  const aktifler = acilDurumAktifler();
  if (!aktifler.length) return 'normal';
  let en = 'bilgi';
  aktifler.forEach(function(k){
    if (ACIL_SEVIYE_SIRA[k.seviye] > ACIL_SEVIYE_SIRA[en]) en = k.seviye;
  });
  return en;
}

/* ============================================================
   KAYNAK → SAYFA EŞLEMESİ
   ============================================================
   Bir alarm kaydının 'kaynak' alanını, o alt sistemin durumunu
   gösteren sayfaya eşler. acil-durum.html bu eşlemeyi kullanarak
   bir alarma tıklandığında kullanıcıyı doğrudan ilgili sayfaya
   yönlendirir. Yeni bir alt sistem eklendiğinde buraya bir satır
   eklemek yeterlidir (anahtar küçük harfe çevrilip aranır, tam
   eşleşme yoksa anahtar kaynağın içinde geçiyor mu diye de bakılır). */
const ACIL_KAYNAK_SAYFA = {
  '1. plastik ezme ünitesi (0.5l)':  'ezme1-05l.html',
  '1. plastik ezme ünitesi (1-3l)':  'ezme1-13l.html',
  '2. plastik ezme ünitesi (0.5l)':  'ezme2-05l.html',
  '2. plastik ezme ünitesi (1-3l)':  'ezme2-13l.html',
  '1. plastik ezme ünitesi':        'ezme1-05l.html',
  '2. plastik ezme ünitesi':        'ezme2-05l.html',
  'teneke/alüminyum ezme':          'ezme3.html',
  '1. cam kırma':                   'cam-kirma.html',
  '2. cam kırma':                   'cam-kirma2.html',
  'cam kırma ünitesi':              'cam-kirma.html',
  'su tankı karıştırma':            'atik-su-karistirma.html',
  'atık su tankı karıştırma':       'atik-su-karistirma.html',
  'atık su pompa':                  'atik-su-pompa.html',
  'doluluk sensörü':                'doluluk.html',
  'doluluk':                        'doluluk.html',
  // doluluk.html'deki renderDoluluk() bölme adlarıyla (bolmeler[].ad,
  // doluluk-veri.js) BİREBİR aynı olmalı — o fonksiyon acilDurumAlarmVer()'i
  // doğrudan bölmenin "ad" alanıyla çağırıyor (örn. 'Plastik Atık').
  // Bu anahtarlar eksik olduğunda alarm kaydı düşüyordu ama acil-durum.html
  // üzerinde tıklanınca ilgili sayfaya yönlendirme ÇALIŞMIYORDU (sadece
  // "Atık Su Tankı" tesadüfen eşleşiyordu, diğerleri hiç eşleşmiyordu).
  'plastik atık':                   'doluluk.html',
  'teneke / alüminyum':             'ezme3.html',
  'cam atık':                       'doluluk.html',
  'atık su tankı':                  'doluluk.html',
  'kamera sistemi':                 'kamera-durum.html',
  'kamera':                         'kamera-durum.html',
  'ekran paneli':                   'ekran-durumu.html',
  'motor durum özeti':              'motor-durum.html',
  'kapak motor':                    'kapak-motor-durum.html',
  'fan':                            'fan.html'
};

/* Bir kaynak adı için ilgili sayfanın dosya adını döner (bulunamazsa null). */
function acilDurumKaynakSayfasi(kaynak){
  if (!kaynak) return null;
  const anahtar = kaynak.toLocaleLowerCase('tr');

  if (ACIL_KAYNAK_SAYFA[anahtar]) return ACIL_KAYNAK_SAYFA[anahtar];

  var bulunan = null;
  Object.keys(ACIL_KAYNAK_SAYFA).forEach(function(k){
    if (bulunan) return;
    if (anahtar.indexOf(k) !== -1 || k.indexOf(anahtar) !== -1) bulunan = ACIL_KAYNAK_SAYFA[k];
  });
  return bulunan;
}

/* ── Ses tercihi ── */
function acilDurumSesKapaliMi(){
  try { return JSON.parse(localStorage.getItem(ACIL_SES_KEY) || 'false'); }
  catch(e){ return false; }
}
function acilDurumSesAyarla(kapaliMi){
  try { localStorage.setItem(ACIL_SES_KEY, JSON.stringify(!!kapaliMi)); }
  catch(e){ /* sessizce geç */ }
}

/* ── Demo modu tercihi (varsayılan: KAPALI) ──
   Artık gerçek alt sistemler (ezme üniteleri, cam kırma, su karıştırma,
   doluluk, kamera, ekran paneli) kendi gerçek olaylarını doğrudan
   acilDurumAlarmVer() ile bildiriyor. Demo modu yalnızca donanım/alt
   sistem bağlanmadan önce panelin nasıl görüneceğini denemek isteyenler
   için opsiyonel bir anahtar olarak kalıyor. */
function acilDurumDemoAcikMi(){
  try {
    const deger = localStorage.getItem(ACIL_DEMO_KEY);
    return deger === null ? false : JSON.parse(deger);
  } catch(e){ return false; }
}
function acilDurumDemoAyarla(acikMi){
  try { localStorage.setItem(ACIL_DEMO_KEY, JSON.stringify(!!acikMi)); }
  catch(e){ /* sessizce geç */ }
}

/* ============================================================
   BACKEND SENKRONİZASYONU — GERÇEK ARIZA KAYITLARINI DA GÖSTER
   ============================================================
   SORUN: Bu dosyadaki alarm kayıtları (acilDurumAlarmVer, acilDurumAktifler
   vb.) tamamen localStorage'da tutuluyordu. Bir sıkışma/arıza, olayın
   gerçekleştiği TARAYICIDA acilDurumAlarmVer() çağrısıyla kaydediliyordu.
   Ama "Acil Durum & Alarm" panelini (acil-durum.html) başka bir cihazda/
   tarayıcıda (örn. yöneticinin telefonu, farklı bir oturum) açan biri,
   o tarayıcının localStorage'ında hiçbir şey olmadığı için alarmı HİÇ
   göremiyordu — arıza backend'e (fault_records) gerçekten düşmüş olsa bile.
   ariza-bildir.html gibi diğer sayfalar zaten tamamen backend'den okuyup
   yazıyor; bu dosya da artık backend'deki açık (OPEN/IN_PROGRESS) arıza
   kayıtlarını çekip yerel kayıtlarla birleştiriyor.

   apiIstek() fonksiyonu makine-veri.js içinde tanımlı — bu dosyayı
   kullanan her sayfada (acil-durum.html, ezme*.html vb.) makine-veri.js
   zaten önceden yükleniyor.
   ============================================================ */

let _acilBackendArizalari = [];

async function acilDurumBackendArizalariniYukle(){
  if (typeof apiIstek !== 'function') return []; // makine-veri.js yüklenmemiş olabilir
  try {
    const [acik, devamEden] = await Promise.all([
      apiIstek('/api/faults?status=OPEN'),
      apiIstek('/api/faults?status=IN_PROGRESS').catch(function(){ return []; })
    ]);
    _acilBackendArizalari = (acik || []).concat(devamEden || []);
  } catch (e) {
    console.warn('[acil-durum] Backend arıza listesi çekilemedi:', e.message);
  }
  return _acilBackendArizalari;
}

// fault_description içinde "Öncelik: Kritik/Orta/Düşük" geçiyorsa (ariza-bildir.html
// bu formatta yazıyor) buna göre seviye belirler; bulunamazsa güvenli tarafta
// kalıp 'kritik' varsayar (gerçek bir arıza bildirimini asla gizlememek için).
function _acilOncelikSeviyeCikar(aciklama){
  const eslesme = /Öncelik:\s*(Düşük|Orta|Kritik)/i.exec(aciklama || '');
  if (!eslesme) return 'kritik';
  const o = eslesme[1].toLocaleLowerCase('tr');
  if (o === 'düşük') return 'bilgi';
  if (o === 'orta') return 'uyari';
  return 'kritik';
}

/* Yerel (localStorage) aktif alarmlarla, backend'deki açık arıza kayıtlarını
   TEK bir listede birleştirir. Bir backend kaydı zaten yerel bir alarmın
   backendFaultId'siyle eşleşiyorsa (yani bu alarm zaten bu tarayıcıdan
   bildirilmişse) mükerrer gösterilmez. */
function acilDurumBirlesikAktifler(){
  const yerel = acilDurumAktifler();
  const yereldeVarOlanFaultId = {};
  yerel.forEach(function(k){ if (k.backendFaultId) yereldeVarOlanFaultId[String(k.backendFaultId)] = true; });

  const backendTemelli = (_acilBackendArizalari || [])
    .filter(function(f){ return !yereldeVarOlanFaultId[String(f.fault_id)]; })
    .map(function(f){
      return {
        id: 'backend-' + f.fault_id,
        kaynak: f.machine_code ? ('Makine ' + f.machine_code) : 'Bilinmeyen Makine',
        seviye: _acilOncelikSeviyeCikar(f.fault_description),
        mesaj: f.fault_description,
        zaman: new Date(f.created_at).getTime(),
        onaylandi: false,
        giderildi: false,
        backendFaultId: f.fault_id,
        backendKaynakli: true
      };
    });

  return yerel.concat(backendTemelli).sort(function(a, b){ return b.zaman - a.zaman; });
}

/* Birleşik listeye göre en yüksek aktif seviyeyi döner. */
function acilDurumBirlesikMevcutSeviye(){
  const aktifler = acilDurumBirlesikAktifler();
  if (!aktifler.length) return 'normal';
  let en = 'bilgi';
  aktifler.forEach(function(k){
    if (ACIL_SEVIYE_SIRA[k.seviye] > ACIL_SEVIYE_SIRA[en]) en = k.seviye;
  });
  return en;
}


let _acilAudioCtx = null;
function acilDurumBipCal(){
  if (acilDurumSesKapaliMi()) return;
  try {
    if (!_acilAudioCtx) _acilAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _acilAudioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.001;
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch(e){ /* tarayıcı izin vermediyse veya henüz kullanıcı etkileşimi olmadıysa sessizce geç */ }
}

/* ============================================================
   DEMO / TEST AMAÇLI RASTGELE ALARM ÜRETİMİ
   Gerçek donanım bağlanana kadar panelin boş görünmemesi için,
   düşük bir olasılıkla örnek alarmlar üretir. acil-durum.html
   üzerindeki "Demo Modu" anahtarı ile açılıp kapatılabilir.
   ============================================================ */
const ACIL_DEMO_KAYNAKLARI = [
  { kaynak: '1. Plastik Ezme Ünitesi',      seviye: 'kritik', mesaj: 'Sıkışma algılandı, motor otomatik durduruldu.' },
  { kaynak: '2. Plastik Ezme Ünitesi',      seviye: 'kritik', mesaj: 'Sıkışma algılandı, motor otomatik durduruldu.' },
  { kaynak: 'Teneke/Alüminyum Ezme',        seviye: 'kritik', mesaj: 'Sıkışma algılandı, motor otomatik durduruldu.' },
  { kaynak: 'Cam Kırma Ünitesi',            seviye: 'kritik', mesaj: 'Sıkışma algılandı, bıçak otomatik durduruldu.' },
  { kaynak: 'Su Tankı Karıştırma',          seviye: 'uyari',  mesaj: 'Tıkanma şüphesi, motor akımı yükseldi.' },
  { kaynak: 'Doluluk Sensörü',              seviye: 'uyari',  mesaj: 'Depolama bölmesi %90 doluluğa ulaştı.' },
  { kaynak: 'Kamera Sistemi',               seviye: 'uyari',  mesaj: 'Bir kameradan görüntü sinyali alınamıyor.' },
  { kaynak: 'Ekran Paneli',                 seviye: 'bilgi',  mesaj: 'Bir tablet 8 saniyeden uzun süredir sinyal göndermiyor.' },
  { kaynak: 'Motor Durum Özeti',            seviye: 'bilgi',  mesaj: 'Bir motorda anlık akım dalgalanması gözlendi.' }
];

function acilDurumDemoTetikle(){
  const secim = ACIL_DEMO_KAYNAKLARI[Math.floor(Math.random() * ACIL_DEMO_KAYNAKLARI.length)];
  return acilDurumAlarmVer(secim.kaynak, secim.seviye, secim.mesaj);
}

/* Periyodik olarak (dışarıdan setInterval ile) çağrılır; düşük
   olasılıkla yeni bir demo alarm üretir. Demo Modu kapalıysa hiçbir
   şey yapmaz. */
function acilDurumDemoTick(ihtimal){
  if (!acilDurumDemoAcikMi()) return;
  if (Math.random() < (ihtimal || 0.05)) acilDurumDemoTetikle();
}