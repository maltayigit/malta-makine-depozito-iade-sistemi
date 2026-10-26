/* ============================================================
   ORTAK DOLULUK VERİ KAYNAĞI — GERÇEK BACKEND SÜRÜMÜ
   index.html VE doluluk.html BU DOSYAYI BİRLİKTE KULLANIR.

   Artık localStorage'da rastgele veri üretmek yerine gerçek
   backend API'sinden okuyor/yazıyor:
     GET   /api/machines              → oturumdaki kullanıcının makinesi
     GET   /api/machines/:id/doluluk  → { plastik, teneke, cam, atiksu }
     GET   /api/machines/:id/compartments → bölme meta verisi (kapasite, birim, ad)
     POST  /api/machines/:id/compartments/:code/empty → tek bölmeyi boşalt

   auth.js bu dosyadan ÖNCE yüklenmiş olmalı (AUTH_API_BASE ve
   oturumAccessTokenGetir() buradan kullanılıyor).

   NOT: Eski demo sürümünde doluluk artışı, hangi ezme/cam kırma/su
   karıştırma ünitesinin "çalışıyor" olduğuna bakılarak yerelde simüle
   ediliyordu (DOLULUK_UNITE_ESLESME vb.). Gerçek entegrasyonda bu
   artış fiziksel cihazın kendisinden (sensör → backend PATCH
   /compartments/:code) geliyor; panelin görevi artık sadece sunucudaki
   güncel yüzdeleri periyodik olarak okuyup (polling) ekrana basmak.
   ============================================================ */

// Görsel meta veri (renk/ikon backend'de yok, sadece burada tutulur).
// ad/birim/kapasite başlangıç değerleri; sayfa açılışında sunucudaki
// gerçek /compartments verisiyle güncellenir (bolmeMetaSenkronizeEt).
const bolmeler = [
  {
    id: 'plastik',
    ad: 'Plastik Atık',
    birim: 'adet',
    kapasite: 6000,
    renk: '#0F6E56',
    icon: '<path d="M8 2h8v3l2 2v13a1 1 0 01-1 1H7a1 1 0 01-1-1V7l2-2V2z"/><path d="M9 2v3M15 2v3"/>'
  },
  {
    id: 'teneke',
    ad: 'Teneke / Alüminyum',
    birim: 'adet',
    kapasite: 8000,
    renk: '#2E86AB',
    icon: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2"/>'
  },
  {
    id: 'cam',
    ad: 'Cam Atık',
    birim: 'adet',
    kapasite: 250,
    renk: '#8E44AD',
    icon: '<path d="M9 2h6l1 6-1 3v9a2 2 0 01-2 2h-2a2 2 0 01-2-2v-9L8 8z"/>'
  },
  {
    id: 'atiksu',
    ad: 'Atık Su Tankı',
    birim: 'litre',
    kapasite: 750,
    renk: '#3A6EA5',
    icon: '<path d="M12 2C8 8 5 11.5 5 15a7 7 0 0014 0c0-3.5-3-7-7-13z"/>'
  }
];

// Hangi işleme ünitesinin (ezme-veri.js -> uniteAyarlari[x].sayacKey) hangi
// doluluk bölmesini beslediğini eşler. Saf UI/görsel bilgidir — backend'de
// buna karşılık gelen bir tablo/endpoint yok (machine_units ile
// machine_compartments arasında FK ilişkisi kurulmamış), bu yüzden statik
// olarak burada tanımlanıyor. motor-durum.html'deki besledigiBolmeyiBul()
// bu haritayı kullanarak her motor kartında "Beslediği bölme: X — %Y"
// bilgisini gösterir.
const DOLULUK_UNITE_ESLESME = {
  plastik: ['ezme1_05lState', 'ezme1_13lState', 'ezme2_05lState', 'ezme2_13lState'],
  teneke: ['ezme3State'],
  cam: ['camKirmaState', 'camKirma2State'],
  atiksu: ['suKaristirmaState', 'atikSuPompaState']
};

// Backend'deki migration 002 varsayılanlarıyla birebir aynı (machine_compartments).
const DOLULUK_UYARI_ESIK = 60;
const DOLULUK_KRITIK_ESIK = 85;
const DOLULUK_OTOMATIK_KAPANMA_ESIK = 98;

function durum(yuzde){
  if (yuzde >= DOLULUK_KRITIK_ESIK) return { key: 'kritik', ad: 'Kritik' };
  if (yuzde >= DOLULUK_UYARI_ESIK) return { key: 'uyari', ad: 'Uyarı' };
  return { key: 'normal', ad: 'Normal' };
}

/* ============================================================
   API YARDIMCILARI
   ============================================================ */

let _aktifMakineId = null;
let _bolmeMetaSenkronEdildi = false;
let _sonDolulukVerisi = null;              // en son başarıyla çekilen veri (senkron erişim isteyen yerler için önbellek)
let _bekleyenOtomatikKapanmaBildirimi = null; // dolulukTick() bir bölmenin eşiği yeni geçtiğini görürse buraya yazar

async function _apiIstek(yol, secenekler){
  const token = (typeof oturumAccessTokenGetir === 'function') ? oturumAccessTokenGetir() : null;
  const res = await fetch(AUTH_API_BASE + yol, Object.assign({}, secenekler, {
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      (secenekler && secenekler.headers) || {}
    )
  }));

  if (res.status === 401){
    // Access token geçersiz/süresi dolmuş → oturumu kapat, login'e dön.
    if (typeof cikisYap === 'function') cikisYap();
    throw new Error('Oturum geçersiz, tekrar giriş yapmanız gerekiyor.');
  }
  if (!res.ok){
    let mesaj = 'İstek başarısız oldu (' + res.status + ')';
    try { const hata = await res.json(); if (hata && hata.message) mesaj = hata.message; } catch(e){ /* yoksay */ }
    throw new Error(mesaj);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Oturumdaki kullanıcının kapsamındaki makineyi bulur ve önbelleğe alır.
// MARKET rolündeki kullanıcılar zaten sadece kendi marketlerinin
// makinesini görür (backend scope filtrelemesi), bu yüzden ilk sonucu
// almak bu panel için yeterlidir.
async function aktifMakineIdGetir(){
  if (_aktifMakineId) return _aktifMakineId;
  const kayitli = localStorage.getItem('aktifMakineId');
  if (kayitli){ _aktifMakineId = kayitli; return kayitli; }

  const makineler = await _apiIstek('/api/machines');
  if (!makineler || !makineler.length){
    throw new Error('Bu kullanıcıya atanmış bir makine bulunamadı.');
  }
  _aktifMakineId = makineler[0].machine_id;
  localStorage.setItem('aktifMakineId', String(_aktifMakineId));
  return _aktifMakineId;
}

// Bölmelerin ad/birim/kapasite bilgisini sunucudaki gerçek değerlerle
// bir kez senkronize eder (yönetici panelden kapasite değiştirilmişse
// panel bunu otomatik yansıtsın diye). Renk/ikon sadece görsel olduğu
// için backend'de yok, burada sabit kalıyor.
async function _bolmeMetaSenkronizeEt(makineId){
  if (_bolmeMetaSenkronEdildi) return;
  try{
    const sunucuBolmeleri = await _apiIstek('/api/machines/' + makineId + '/compartments');
    sunucuBolmeleri.forEach(function(sb){
      const yerel = bolmeler.find(function(b){ return b.id === sb.compartment_code; });
      if (yerel){
        yerel.ad = sb.display_name || yerel.ad;
        yerel.birim = sb.unit || yerel.birim;
        yerel.kapasite = Number(sb.capacity) || yerel.kapasite;
      }
    });
    _bolmeMetaSenkronEdildi = true;
  }catch(e){
    console.error('[doluluk] Bölme meta verisi alınamadı, varsayılan değerler kullanılıyor:', e);
  }
}

/* ============================================================
   DOLULUK VERİSİ OKUMA / YAZMA
   ============================================================ */

// Sunucudan güncel doluluk yüzdelerini çeker: { plastik, teneke, cam, atiksu }
async function dolulukVeriGetir(){
  try{
    const makineId = await aktifMakineIdGetir();
    await _bolmeMetaSenkronizeEt(makineId);
    const veri = await _apiIstek('/api/machines/' + makineId + '/doluluk');
    _sonDolulukVerisi = veri;
    return veri;
  }catch(e){
    console.error('[doluluk] Sunucudan veri alınamadı:', e);
    // Ağ/backend geçici olarak ulaşılamaz olsa bile ekran boş kalmasın diye
    // en son bilinen veriyi (yoksa hepsi %0) döndür.
    return _sonDolulukVerisi ? Object.assign({}, _sonDolulukVerisi) : _bosVeri();
  }
}

function _bosVeri(){
  const veri = {};
  bolmeler.forEach(function(b){ veri[b.id] = 0; });
  return veri;
}

// Geriye dönük uyumluluk: doluluk.html (ve index.html) dolulukYukle() çağırıyordu.
// Artık ağ isteği içerdiği için Promise döner — çağıran taraf 'await' etmeli.
async function dolulukYukle(){
  return dolulukVeriGetir();
}

// Ağ çağrısı yapmadan en son bilinen veriyi anlık döner (senkron gereken
// nadir durumlar için; sayfa henüz hiç veri çekmediyse hepsi %0 döner).
function dolulukSonBilinenVeri(){
  return _sonDolulukVerisi ? Object.assign({}, _sonDolulukVerisi) : _bosVeri();
}

// Periyodik "canlı güncelleme" için kullanılır. Eskiden burada rastgele
// artış simüle ediliyordu; artık sadece sunucudaki güncel değerleri
// POLL eder (gerçek entegrasyon: fiziksel cihaz kendi sensör verisini
// PATCH /api/machines/:id/compartments/:code ile backend'e zaten yazıyor).
async function dolulukTick(){
  const eskiVeri = _sonDolulukVerisi ? Object.assign({}, _sonDolulukVerisi) : null;
  const veri = await dolulukVeriGetir();

  // Bir bölme bu tick'te otomatik kapanma eşiğini YENİ geçtiyse (öncekinde
  // altındaydı) kullanıcıya "Makine Otomatik Kapatıldı" uyarısı gösterilecek
  // şekilde işaretle. Makinenin fiilen kapatılması backend'in kendi işi
  // (PATCH sırasında ya da /power açılış kontrolünde uygulanıyor); burada
  // sadece panelde bilgilendirme yapılıyor.
  if (eskiVeri){
    const yeniEsikGecenler = dolulukEsikUstuBolmeleriBul(veri, DOLULUK_OTOMATIK_KAPANMA_ESIK)
      .filter(function(b){ return (eskiVeri[b.id] ?? 0) < DOLULUK_OTOMATIK_KAPANMA_ESIK; });
    if (yeniEsikGecenler.length) _bekleyenOtomatikKapanmaBildirimi = yeniEsikGecenler;
  }

  return veri;
}

// Tüm bölmeleri sunucuda boşaltır (her biri için ayrı POST .../empty).
async function dolulukTumunuBosalt(){
  const makineId = await aktifMakineIdGetir();
  await Promise.all(bolmeler.map(function(b){
    return _apiIstek('/api/machines/' + makineId + '/compartments/' + b.id + '/empty', { method: 'POST' });
  }));
  return dolulukVeriGetir();
}

// Tek bir bölmeyi boşaltır (ör. ileride bölme bazlı "Boşalt" butonu için).
async function dolulukBosalt(id){
  const makineId = await aktifMakineIdGetir();
  await _apiIstek('/api/machines/' + makineId + '/compartments/' + id + '/empty', { method: 'POST' });
  return dolulukVeriGetir();
}

// Verilen eşiğe (varsayılan: otomatik kapanma eşiği) ulaşmış/geçmiş bölmeleri döndürür.
function dolulukEsikUstuBolmeleriBul(veri, esik){
  const sonuc = [];
  bolmeler.forEach(function(b){
    const yuzde = veri[b.id] ?? 0;
    if (yuzde >= esik) sonuc.push({ id: b.id, ad: b.ad, yuzde: yuzde });
  });
  return sonuc;
}

// Makinenin açılmasını engelleyen bir doluluk durumu var mı? (En son bilinen
// veriye göre, senkron/hızlı bir ön-kontrol; kesin karar backend'de
// PATCH /api/machines/:id/power sırasında zaten uygulanıyor — orası
// gerçek engellemeyi 409 hatasıyla yapar.)
function dolulukMakineAcmaEngelliMi(){
  return dolulukEsikUstuBolmeleriBul(dolulukSonBilinenVeri(), DOLULUK_OTOMATIK_KAPANMA_ESIK).length > 0;
}

/* ── Kritik uyarı banner'ı (her iki sayfada da kullanılıyor) ───────────────*/
function uyariSesiCal(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }catch(e){ /* ses desteklenmiyorsa sessizce geç */ }
}

let oncekiKritikler = [];
function renderUyariBanner(kritikBolmeler, detayLinkiGoster){
  const wrap = document.getElementById('doluluk-alert-wrap');
  if (!wrap) return;

  if (kritikBolmeler.length === 0){
    wrap.innerHTML = '';
    oncekiKritikler = [];
    return;
  }

  const isimler = kritikBolmeler.map(function(b){ return b.ad + ' (%' + b.yuzde + ')'; }).join(', ');
  const link = detayLinkiGoster
    ? ' <a href="doluluk.html" style="color:#C0392B; text-decoration:underline;">Detayları görüntüle →</a>'
    : '';

  wrap.innerHTML = `
    <div class="doluluk-alert" role="alert">
      <span class="doluluk-alert-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
      </span>
      <div class="doluluk-alert-body">
        <p class="doluluk-alert-title">Kritik Doluluk Uyarısı</p>
        <p class="doluluk-alert-text"><strong>${isimler}</strong> kritik seviyeye ulaştı. En kısa sürede boşaltılması gerekiyor.${link}</p>
      </div>
    </div>`;

  const yeniKritikVar = kritikBolmeler.some(function(b){ return oncekiKritikler.indexOf(b.id) === -1; });
  if (yeniKritikVar) uyariSesiCal();
  oncekiKritikler = kritikBolmeler.map(function(b){ return b.id; });
}

// Bekleyen bir "otomatik kapanma" bildirimi varsa (dolulukTick() tarafından
// işaretlenir), mevcut sayfadaki güvenlik uyarısı modalıyla
// (#warn-overlay / #warn-list) gösterir.
function dolulukOtomatikKapanmaBildirimiGosterVarsa(){
  if (!_bekleyenOtomatikKapanmaBildirimi || !_bekleyenOtomatikKapanmaBildirimi.length) return;
  const bildirim = _bekleyenOtomatikKapanmaBildirimi;
  _bekleyenOtomatikKapanmaBildirimi = null;

  const overlay = document.getElementById('warn-overlay');
  const liste = document.getElementById('warn-list');
  if (overlay && liste){
    const baslik = document.getElementById('warn-title');
    const metin = document.getElementById('warn-text');
    if (baslik) baslik.textContent = 'Makine Otomatik Kapatıldı';
    if (metin) metin.textContent = 'Aşağıdaki hazne(ler) %' + DOLULUK_OTOMATIK_KAPANMA_ESIK + ' doluluğa ulaştığı için makine kendiliğinden kapatıldı. Tekrar açabilmek için ilgili hazneleri boşaltın.';
    liste.innerHTML = bildirim.map(function(b){
      return '<li><span class="warn-dot"></span>' + b.ad + ' — %' + b.yuzde + ' dolu</li>';
    }).join('');
    overlay.classList.add('show');
  }
}

function kritikBolmeleriBul(veri){
  const sonuc = [];
  bolmeler.forEach(function(b){
    const yuzde = veri[b.id] ?? 0;
    if (durum(yuzde).key === 'kritik') sonuc.push({ id: b.id, ad: b.ad, yuzde: yuzde });
  });
  return sonuc;
}

/* ── Doluluk → Merkezi Acil Durum senkronizasyonu ─────────────────────────
   %60 ve üstü (uyarı seviyesi ve üstü) her bölme için merkezi acil durum
   panelinde bir alarm oluşturur/günceller; doluluk oranı değiştikçe
   alarmın seviyesi de (bilgi/uyarı/kritik) güncellenir. Bölme %60'ın
   altına inip normale döndüğünde alarm otomatik olarak giderilir.
   (Bu mantık değişmedi — sadece artık gerçek sunucu verisiyle çalışıyor.) */
var _acilBilinenUyariBolmeler = null; // null: henüz başlatılmadı (ilk çağrıda mevcut aktif alarmlardan doldurulur)

function dolulukAcilSeviye(yuzde){
  if (yuzde >= DOLULUK_OTOMATIK_KAPANMA_ESIK) return 'kritik';
  if (yuzde >= DOLULUK_KRITIK_ESIK) return 'uyari';
  return 'bilgi';
}

function dolulukAcilDurumSenkronizeEt(veri){
  if (typeof acilDurumAlarmVer !== 'function') return; // acil-durum-veri.js bu sayfada yüklü değil

  if (_acilBilinenUyariBolmeler === null){
    _acilBilinenUyariBolmeler = {};
    if (typeof acilDurumAktifler === 'function'){
      var aktifKayitlar = acilDurumAktifler();
      bolmeler.forEach(function(b){
        var eslesen = aktifKayitlar.find(function(k){ return k.kaynak === b.ad; });
        if (eslesen) _acilBilinenUyariBolmeler[b.id] = eslesen.seviye;
      });
    }
  }

  var suankiSeviyeler = {};
  bolmeler.forEach(function(b){
    var yuzde = veri[b.id] ?? 0;
    if (durum(yuzde).key === 'normal') return; // %60 altı → alarma konu değil

    var seviye = dolulukAcilSeviye(yuzde);
    suankiSeviyeler[b.id] = seviye;
    var oncekiSeviye = _acilBilinenUyariBolmeler[b.id];
    if (oncekiSeviye !== seviye){
      if (oncekiSeviye && typeof acilDurumGiderKaynak === 'function') acilDurumGiderKaynak(b.ad);
      acilDurumAlarmVer(b.ad, seviye, 'Depolama bölmesi %' + yuzde + ' doluluğa ulaştı.');
    }
  });

  Object.keys(_acilBilinenUyariBolmeler).forEach(function(id){
    if (!suankiSeviyeler[id]){
      var eskiBolme = bolmeler.find(function(b){ return b.id === id; });
      if (eskiBolme && typeof acilDurumGiderKaynak === 'function') acilDurumGiderKaynak(eskiBolme.ad);
    }
  });

  _acilBilinenUyariBolmeler = suankiSeviyeler;
}

// Sayfa bazlı çağrı: her iki sayfa da bunu DOMContentLoaded içinde çağırır.
// dolulukYukle() artık async olduğu için bu fonksiyon da async oldu —
// çağıran taraf 'await doluluguKontrolEt(...)' kullanmalı.
async function doluluguKontrolEt(detayLinkiGoster){
  const veri = await dolulukYukle();
  renderUyariBanner(kritikBolmeleriBul(veri), detayLinkiGoster);
  return veri;
}

// Arka planda hangi sayfada olursak olalım verilerin güncellenmesini sağlar.
// Not: doluluk.html kendi setInterval'ında zaten dolulukTick() + renderDoluluk()
// çağırıyor; bu arka plan zamanlayıcısı doluluk.html AÇIK OLMASA bile (ör.
// sadece index.html açıkken) merkezi acil durum senkronizasyonunun ve
// otomatik kapanma bildiriminin çalışmaya devam etmesi içindir.
if (typeof dolulukTick === 'function') {
  setInterval(async function(){
    try{
      const veri = await dolulukTick();
      dolulukAcilDurumSenkronizeEt(veri);
      if (typeof dolulukOtomatikKapanmaBildirimiGosterVarsa === 'function') {
        dolulukOtomatikKapanmaBildirimiGosterVarsa();
      }
    }catch(e){
      console.error('[doluluk] Arka plan güncellemesi başarısız:', e);
    }
  }, 4000); // 4 saniyede bir arka planda sunucudan güncel veriyi çeker
}