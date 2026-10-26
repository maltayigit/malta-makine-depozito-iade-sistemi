/* ============================================================
   ORTAK EZME / KIRMA VERİ KAYNAĞI — GERÇEK BACKEND SÜRÜMÜ
   ezme1.html, ezme2.html, ezme3.html, cam-kirma.html, cam-kirma2.html,
   su-karistirma.html, atik-su-pompa.html ve motor-durum.html bu
   dosyayı birlikte kullanır.

   auth.js VE doluluk-veri.js bu dosyadan ÖNCE yüklenmiş olmalı
   (AUTH_API_BASE, oturumAccessTokenGetir, _apiIstek, aktifMakineIdGetir
   fonksiyonları doluluk-veri.js'den kullanılıyor).

   NOT — BACKEND'İN SINIRLARI:
   machine_units tablosunda sadece is_running / is_jammed / cycle_count
   alanları var. Sıcaklık, anlık yük (%) ve "son işlemler" listesi
   backend'de tutulmuyor (henüz fiziksel sensör/PLC entegrasyonu yok).
   Bu üç alan bu yüzden hâlâ istemci tarafında (localStorage) simüle
   ediliyor. Buna karşılık ÇALIŞIYOR / SIKIŞMA / TOPLAM ÇEVRİM SAYISI
   artık gerçek backend'den okunuyor ve yazılıyor — demo modunda rastgele
   üretilen sıkışmalar bile artık gerçek PATCH /units/:code çağrısıyla
   backend'e işleniyor (fiziksel bir sıkışma sensörünün yapacağı gibi).

   cycle_count, ünite her BAŞLATILDIĞINDA (isRunning:true PATCH'i) 1
   artıyor; "bugünkü işlem adedi" değil, kümülatif başlatma sayısıdır.
   Ürün bazlı gerçek sayaç isteniyorsa machine_units'e ayrı bir kolon
   eklenmesi gerekir (bugün bu değişikliğin kapsamında değil).
   ============================================================ */

const kapakIsimleriEzme = [
  'Tablet Bakım Kapağı', 'Su Tahliye Kapağı', 'Metal Atık kapağı', 'Cam Atık Kapağı', 'Plastik Atık Kapağı',
  'Plastik Kapak Kutusu', 'Ups Kapağı', 'Üst Pano Kapağı', 'Pil Kutusu Kapağı', 'Elektrik Pano Kapağı'
];

function acikKapaklariGetir(indeksler){
  const kapaklar = JSON.parse(localStorage.getItem('kapakDurumu') || '[]');
  const acik = [];
  indeksler.forEach(function(i){
    if (kapaklar[i]) acik.push(kapakIsimleriEzme[i] || ('Kapak ' + (i + 1)));
  });
  return acik;
}

function rastgele(min, max){
  return Math.round(min + Math.random() * (max - min));
}

function saatStr(d){
  d = d || new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

/* Ünite ayarları: renk, kapak bağımlılığı, ürün etiketleri, birim isimleri.
   backendKod: machine_units.unit_code ile birebir eşleşen değer (DEFAULT_UNITS,
   machines.routes.js). Frontend'in kendi 'anahtar' değerlerinden (camkirma,
   camkirma2 gibi küçük harfli) farklı olabilir, o yüzden ayrı tutuluyor. */
const uniteAyarlari = {
  ezme1_05l: {
    anahtar: 'ezme1_05l', sayfa: 'ezme1-05l.html', backendKod: 'ezme1_05l',
    baslik: '1. Plastik Ezme Ünitesi (0.5L)', altBaslik: 'Plastik Ezme Hattı (0.5L)',
    renk: '#0F6E56', renkAcik: '#E8F5F0',
    kapakIndeks: [4, 5],
    islemAdi: 'Plastik şişe ezildi',
    boyutlar: ['0.5 L'],
    sayacKey: 'ezme1_05lState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [60, 180],
    // Aşağıdaki 5 alan SADECE unite.html (genel şablon) tarafından
    // ekrana basılan metinler için kullanılır; iş mantığını etkilemez.
    sekmeBaslik: 'Malta Makine — 1. Plastik Ezme (0.5L) Durum',
    eyebrow: 'Ezme Ünitesi 1 (0.5L) · Malta',
    h1: '1. Ezme Durum — Plastik (0.5L)',
    motorEtiketi: 'Plastik Ezme Motoru',
    guvenlikNotuHtml: '<strong>Plastik Atık Kapağı</strong> veya <strong>Plastik Kapak Kutusu</strong> açıkken ezici motor güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapaklar açılamaz.',
    navEtiket: '(0.5L) 1. Plastik Ezme Durum'
  },
  ezme1_13l: {
    anahtar: 'ezme1_13l', sayfa: 'ezme1-13l.html', backendKod: 'ezme1_13l',
    baslik: '1. Plastik Ezme Ünitesi (1-3L)', altBaslik: 'Plastik Ezme Hattı (1-3L)',
    renk: '#118C6D', renkAcik: '#E8F5F0',
    kapakIndeks: [4, 5],
    islemAdi: 'Plastik şişe ezildi',
    boyutlar: ['1 L', '1.5 L', '2 L', '2.5 L', '3 L'],
    sayacKey: 'ezme1_13lState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [40, 140],
    sekmeBaslik: 'Malta Makine — 1. Plastik Ezme (1-3L) Durum',
    eyebrow: 'Ezme Ünitesi 1 (1-3L) · Malta',
    h1: '1. Ezme Durum — Plastik (1-3L)',
    motorEtiketi: 'Plastik Ezme Motoru',
    guvenlikNotuHtml: '<strong>Plastik Atık Kapağı</strong> veya <strong>Plastik Kapak Kutusu</strong> açıkken ezici motor güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapaklar açılamaz.',
    navEtiket: '(1-3L) 1. Plastik Ezme Durum'
  },
  ezme2_05l: {
    anahtar: 'ezme2_05l', sayfa: 'ezme2-05l.html', backendKod: 'ezme2_05l',
    baslik: '2. Plastik Ezme Ünitesi (0.5L)', altBaslik: 'Plastik Ezme Hattı (0.5L)',
    renk: '#16A085', renkAcik: '#E7F7F3',
    kapakIndeks: [4, 5],
    islemAdi: 'Plastik şişe ezildi',
    boyutlar: ['0.5 L'],
    sayacKey: 'ezme2_05lState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [60, 180],
    sekmeBaslik: 'Malta Makine — 2. Plastik Ezme (0.5L) Durum',
    eyebrow: 'Plastik Ezme Ünitesi 2 (0.5L) · Malta',
    h1: '2. Ezme Durum — Plastik (0.5L)',
    motorEtiketi: 'Plastik Ezme Motoru 2',
    guvenlikNotuHtml: '<strong>Plastik Atık Kapağı</strong> veya <strong>Plastik Kapak Kutusu</strong> açıkken ezici motor güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapaklar açılamaz.',
    navEtiket: '(0.5L) 2. Plastik Ezme Durum'
  },
  ezme2_13l: {
    anahtar: 'ezme2_13l', sayfa: 'ezme2-13l.html', backendKod: 'ezme2_13l',
    baslik: '2. Plastik Ezme Ünitesi (1-3L)', altBaslik: 'Plastik Ezme Hattı (1-3L)',
    renk: '#1BA88F', renkAcik: '#E7F7F3',
    kapakIndeks: [4, 5],
    islemAdi: 'Plastik şişe ezildi',
    boyutlar: ['1 L', '1.5 L', '2 L', '2.5 L', '3 L'],
    sayacKey: 'ezme2_13lState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [40, 140],
    sekmeBaslik: 'Malta Makine — 2. Plastik Ezme (1-3L) Durum',
    eyebrow: 'Plastik Ezme Ünitesi 2 (1-3L) · Malta',
    h1: '2. Ezme Durum — Plastik (1-3L)',
    motorEtiketi: 'Plastik Ezme Motoru 2',
    guvenlikNotuHtml: '<strong>Plastik Atık Kapağı</strong> veya <strong>Plastik Kapak Kutusu</strong> açıkken ezici motor güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapaklar açılamaz.',
    navEtiket: '(1-3L) 2. Plastik Ezme Durum'
  },
  ezme3: {
    anahtar: 'ezme3', sayfa: 'ezme3.html', backendKod: 'ezme3',
    baslik: 'Teneke / Alüminyum Ezme Ünitesi', altBaslik: 'Teneke / Alüminyum Ezme Hattı',
    renk: '#2E86AB', renkAcik: '#E6F1FB',
    kapakIndeks: [2],
    islemAdi: 'Teneke kutu ezildi',
    boyutlar: ['0.2 L', '0.33 L'],
    sayacKey: 'ezme3State',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [80, 240],
    sekmeBaslik: 'Malta Makine — Teneke / Alüminyum Ezme Durum',
    eyebrow: 'Teneke / Alüminyum Ezme Ünitesi · Malta',
    h1: 'Teneke / Alüminyum Ezme Durum',
    motorEtiketi: 'Teneke Ezme Motoru',
    guvenlikNotuHtml: '<strong>Metal Atık Kapağı</strong> açıkken ezici motor güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapak açılamaz.',
    navEtiket: 'Teneke/Alüminyum Ezme Durum'
  },
  camkirma: {
    anahtar: 'camkirma', sayfa: 'cam-kirma.html', backendKod: 'camKirma',
    baslik: '1. Cam Kırma Ünitesi', altBaslik: 'Cam Kırma Hattı',
    renk: '#8E44AD', renkAcik: '#F3E5F5',
    kapakIndeks: [3],
    islemAdi: 'Cam şişe kırıldı',
    boyutlar: ['200 ml', '500 ml', '1 L'],
    sayacKey: 'camKirmaState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [40, 160]
  },
  camkirma2: {
    anahtar: 'camkirma2', sayfa: 'cam-kirma2.html', backendKod: 'camKirma2',
    baslik: '2. Cam Kırma Ünitesi', altBaslik: 'Cam Kırma Hattı',
    renk: '#6C3483', renkAcik: '#EEE3F1',
    kapakIndeks: [3],
    islemAdi: 'Cam şişe kırıldı',
    boyutlar: ['200 ml', '500 ml', '1 L'],
    sayacKey: 'camKirma2State',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [40, 160]
  },
  suKaristirma: {
    anahtar: 'suKaristirma', sayfa: 'atik-su-karistirma.html', backendKod: 'suKaristirma',
    baslik: 'Su Tankı Karıştırma Motoru', altBaslik: 'Atık Su Karıştırma Hattı',
    renk: '#3A6EA5', renkAcik: '#EAF1FA',
    kapakIndeks: [1],
    islemAdi: 'Karıştırma çevrimi tamamlandı',
    boyutlar: ['3 dk', '4 dk', '5 dk', '6 dk'],
    sayacKey: 'suKaristirmaState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [30, 90],
    sekmeBaslik: 'Malta Makine — Su Tankı Karıştırma Durum',
    eyebrow: 'Su Tankı Karıştırma Ünitesi · Malta',
    h1: 'Su Tankı Karıştırma Durum',
    motorEtiketi: 'Karıştırma Motoru',
    guvenlikNotuHtml: '<strong>Su Tahliye Kapağı</strong> açıkken karıştırma motoru güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapak açılamaz.',
    navEtiket: 'Atık Su Tankı Karıştırma Durum'
  },
  atikSuPompa: {
    anahtar: 'atikSuPompa', sayfa: 'atik-su-pompa.html', backendKod: 'atikSuPompa',
    baslik: 'Atık Su Pompa Motoru', altBaslik: 'Atık Su Tahliye Hattı',
    renk: '#B9770E', renkAcik: '#FBF0DC',
    kapakIndeks: [1],
    islemAdi: 'Atık su tahliye çevrimi tamamlandı',
    boyutlar: ['5 L', '10 L', '15 L', '20 L'],
    sayacKey: 'atikSuPompaState',
    olcuBirimi: '°C', sicaklikBaslangic: 24, sicaklikMin: 22, sicaklikMax: 58,
    sayacBaslangic: [40, 120],
    sekmeBaslik: 'Malta Makine — Atık Su Pompa Motoru Durum',
    eyebrow: 'Atık Su Pompa Ünitesi · Malta',
    h1: 'Atık Su Pompa Motoru Durum',
    motorEtiketi: 'Pompa Motoru',
    guvenlikNotuHtml: '<strong>Su Tahliye Kapağı</strong> açıkken pompa motoru güvenlik nedeniyle başlatılamaz. Motor çalışırken bu kapak açılamaz.',
    navEtiket: 'Atık Su Pompa Durum'
  }
};

function _ayarSayacKeyIle(sayacKey){
  return Object.keys(uniteAyarlari).map(function(k){ return uniteAyarlari[k]; })
    .find(function(a){ return a.sayacKey === sayacKey; });
}

/* ============================================================
   PAYLAŞILAN BACKEND YARDIMCILARI (_apiIstek, aktifMakineIdGetir)
   Bu ikisi aslında doluluk-veri.js'te de tanımlı. Bazı sayfalar
   (ezme1.html, ezme2.html, ezme3.html, cam-kirma*.html,
   su-karistirma.html, atik-su-pompa.html) SADECE auth.js + bu dosyayı
   yüklüyor, doluluk-veri.js'i yüklemiyor — bu yüzden burada da
   tanımlanmaları şart. motor-durum.html / index.html gibi HER İKİSİNİ
   BİRDEN yükleyen sayfalarda çakışma olmasın diye 'window.X = window.X
   || ...' kalıbı kullanılıyor (düz atama, 'let/const' değil — aksi halde
   iki script aynı ismi bildirirse SyntaxError alınır). Hangi dosya önce
   yüklenirse onun tanımı kazanır, ikisi de aynı davranışı üretir. */
window._apiIstek = window._apiIstek || async function _apiIstek(yol, secenekler){
  const token = (typeof oturumAccessTokenGetir === 'function') ? oturumAccessTokenGetir() : null;
  const res = await fetch(AUTH_API_BASE + yol, Object.assign({}, secenekler, {
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      (secenekler && secenekler.headers) || {}
    )
  }));

  if (res.status === 401){
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
};

window.aktifMakineIdGetir = window.aktifMakineIdGetir || async function aktifMakineIdGetir(){
  if (window._aktifMakineId) return window._aktifMakineId;
  const kayitli = localStorage.getItem('aktifMakineId');
  if (kayitli){ window._aktifMakineId = kayitli; return kayitli; }

  const makineler = await window._apiIstek('/api/machines');
  if (!makineler || !makineler.length){
    throw new Error('Bu kullanıcıya atanmış bir makine bulunamadı.');
  }
  window._aktifMakineId = makineler[0].machine_id;
  localStorage.setItem('aktifMakineId', String(window._aktifMakineId));
  return window._aktifMakineId;
};

/* Bir ünite için sıfırdan varsayılan durum üretir (localStorage boşsa kullanılır).
   calisiyor/sikisma/bugunSayisi burada sadece ilk render'a kadar yer tutucudur;
   birimDurumuYukle() bunları backend'deki gerçek değerlerle üzerine yazar. */
function varsayilanUniteDurumu(ayar){
  return {
    calisiyor: false,
    sikisma: false,
    bugunSayisi: 0,
    sicaklik: ayar.sicaklikBaslangic,
    yuk: 0,
    sonIslemler: []
  };
}

/* ============================================================
   BACKEND ÜNİTE VERİSİ — okuma / yazma
   ============================================================ */

let _sonUniteVerisi = null; // unit_code -> machine_units satırı (önbellek)

async function _uniteListesiGetir(){
  const makineId = await aktifMakineIdGetir();
  const rows = await _apiIstek('/api/machines/' + makineId + '/units');
  const map = {};
  rows.forEach(function(r){ map[r.unit_code] = r; });
  _sonUniteVerisi = map;
  return map;
}

async function _uniteGuncelle(anahtar, govde){
  const ayar = uniteAyarlari[anahtar];
  const makineId = await aktifMakineIdGetir();
  const row = await _apiIstek('/api/machines/' + makineId + '/units/' + ayar.backendKod, {
    method: 'PATCH',
    body: JSON.stringify(govde)
  });
  if (!_sonUniteVerisi) _sonUniteVerisi = {};
  _sonUniteVerisi[ayar.backendKod] = row;
  return row;
}

async function uniteBaslat(anahtar){ return _uniteGuncelle(anahtar, { isRunning: true }); }
async function uniteDurdur(anahtar){ return _uniteGuncelle(anahtar, { isRunning: false }); }
async function uniteSikismaBildir(anahtar){ return _uniteGuncelle(anahtar, { isJammed: true }); }
async function uniteSikismaGiderApi(anahtar){ return _uniteGuncelle(anahtar, { isJammed: false }); }

/* Yerel-yalnız alanlar (sıcaklık/yük/son işlemler) localStorage'da
   ayar.sayacKey ile tutulur. */
function _yerelDurumYukle(ayar){
  const kayitli = JSON.parse(localStorage.getItem(ayar.sayacKey) || 'null');
  return kayitli || varsayilanUniteDurumu(ayar);
}
function _yerelDurumKaydet(ayar, yerel){
  localStorage.setItem(ayar.sayacKey, JSON.stringify(yerel));
}

/* Birim durumu artık backend + yerel simülasyonun birleşimidir.
   ESKİ İMZA KORUNDU (sayacKey ile çağrılıyor) ama artık Promise döner —
   çağıran taraf 'await birimDurumuYukle(...)' kullanmalı. İkinci
   parametre (varsayilan) geriye dönük uyumluluk için kabul edilir ama
   artık kullanılmıyor; varsayılan değerler ayar üzerinden üretiliyor. */
async function birimDurumuYukle(sayacKey, _varsayilanYokSayilir){
  const ayar = _ayarSayacKeyIle(sayacKey);
  if (!ayar) throw new Error('Bilinmeyen ünite anahtarı: ' + sayacKey);

  const yerel = _yerelDurumYukle(ayar);
  try{
    const uniteler = _sonUniteVerisi || await _uniteListesiGetir();
    const backendRow = uniteler[ayar.backendKod];
    if (backendRow){
      yerel.calisiyor = backendRow.is_running;
      yerel.sikisma = backendRow.is_jammed;
      yerel.bugunSayisi = backendRow.cycle_count;
    }
  }catch(e){
    console.error('[ezme] "' + ayar.backendKod + '" ünitesi backend’den alınamadı, yerel değerler kullanılıyor:', e);
  }
  return yerel;
}

/* Artık sadece sıcaklık/yük/son işlemler gibi yerel-yalnız alanları
   kaydeder. calisiyor/sikisma/bugunSayisi backend'in gerçeğidir; bu
   fonksiyona yazılan değerler backend'i ETKİLEMEZ — onlar için
   uniteBaslat/uniteDurdur/uniteSikismaBildir/uniteSikismaGiderApi
   kullanılmalı. (Eski çağıranlarla uyumluluk için imza korundu.) */
function birimDurumuKaydet(sayacKey, durum){
  const ayar = _ayarSayacKeyIle(sayacKey);
  if (!ayar) return;
  _yerelDurumKaydet(ayar, durum);
}

/* Ana makinenin (index.html'deki AÇIK/KAPALI durumu) artık backend'deki
   machine_power_state üzerinden okunuyor (doluluk-veri.js ile aynı
   makineId'yi kullanır). Senkron erişim isteyen eski kod için önbellek
   tutulur; ilk çağrı öncesi 'false' döner. */
let _sonGucDurumu = false;
async function anaMakineAcikMiAsync(){
  try{
    const makineId = await aktifMakineIdGetir();
    const durum = await _apiIstek('/api/machines/' + makineId + '/power');
    _sonGucDurumu = !!durum.is_powered_on;
  }catch(e){
    console.error('[ezme] Ana makine güç durumu alınamadı:', e);
  }
  return _sonGucDurumu;
}
/* Senkron eski imza korunuyor: en son bilinen (önbelleğe alınmış) değeri
   döner. Sayfa açılışında bir kez anaMakineAcikMiAsync() çağrılmalı. */
function anaMakineAcikMi(){
  return _sonGucDurumu;
}

/* ------------------------------------------------------------------
   SIKIŞMA GÜVENLİK PROTOKOLÜ
   Herhangi bir ünitede sıkışma tespit edildiğinde:
   1) Sıkışan ünite HARİÇ tüm üniteler backend'e PATCH edilerek durdurulur.
   2) Ana makine backend'de KAPALI'ya çekilir (PATCH /power).
   3) 'sikismaBildirimi' anahtarına (yerel) bir bildirim yazılır; index.html
      ve motor-durum.html bunu okuyup kullanıcıya sesli/görsel uyarı gösterir.
   ------------------------------------------------------------------ */

/* Sıkışan ünite hariç diğer tüm üniteleri backend üzerinden durdurur. */
async function digerUniteleriGuvenlikIcinDurdur(sikisanSayacKey){
  const anahtarlar = Object.keys(uniteAyarlari);
  for (const anahtar of anahtarlar){
    const ayar = uniteAyarlari[anahtar];
    if (ayar.sayacKey === sikisanSayacKey) continue;

    const birim = await birimDurumuYukle(ayar.sayacKey);
    if (birim.calisiyor || birim.sikisma){
      try{ await uniteDurdur(anahtar); }catch(e){ console.error('[ezme] Güvenlik durdurma başarısız:', ayar.backendKod, e); }
      const yerel = _yerelDurumYukle(ayar);
      yerel.yuk = 0;
      yerel.sonIslemler.unshift({ zaman: saatStr(), text: 'Güvenlik: başka bir ünitedeki sıkışma nedeniyle otomatik durduruldu' });
      yerel.sonIslemler = yerel.sonIslemler.slice(0, 8);
      _yerelDurumKaydet(ayar, yerel);
    }
  }
}

/* Bir ünite sıkıştığında çağrılır: tüm sistemi durdurur ve ana ekrana
   iletilecek bildirimi oluşturur. Sıkışmanın kendisi (isJammed:true)
   ÇAĞIRANDA zaten backend'e yazılmış olmalı; bu fonksiyon sadece
   güvenlik zincirini (diğer üniteleri durdur + makineyi kapat) işletir. */
async function sikismaBildirimiOlustur(ayar){
  await digerUniteleriGuvenlikIcinDurdur(ayar.sayacKey);
  try{
    const makineId = await aktifMakineIdGetir();
    await _apiIstek('/api/machines/' + makineId + '/power', {
      method: 'PATCH',
      body: JSON.stringify({ isPoweredOn: false })
    });
    _sonGucDurumu = false;
  }catch(e){
    console.error('[ezme] Sıkışma nedeniyle ana makine kapatılamadı:', e);
  }
  localStorage.setItem('sikismaBildirimi', JSON.stringify({
    unite: ayar.baslik,
    anahtar: ayar.anahtar,
    sayfa: ayar.sayfa,
    zaman: saatStr(),
    okundu: false
  }));
}

/* Bekleyen (varsa) sıkışma bildirimini döner.
   İlgili ünitenin sıkışması (başka bir sayfadan "Sıkışmayı Gider" ile)
   giderilmişse, bildirim burada otomatik olarak temizlenir. Artık backend
   sorgulaması içerdiği için Promise döner. */
async function sikismaBildirimiOku(){
  const bildirim = JSON.parse(localStorage.getItem('sikismaBildirimi') || 'null');
  if (!bildirim) return null;

  if (bildirim.anahtar && uniteAyarlari[bildirim.anahtar]){
    const ayar = uniteAyarlari[bildirim.anahtar];
    const birim = await birimDurumuYukle(ayar.sayacKey);
    if (!birim.sikisma){
      localStorage.removeItem('sikismaBildirimi');
      return null;
    }
  }

  return bildirim;
}

/* Kullanıcı bildirimi kapattığında çağrılır. */
function sikismaBildirimiTemizle(){
  localStorage.removeItem('sikismaBildirimi');
}

/* Şu an herhangi bir ünitede giderilmemiş sıkışma var mı? (Makinenin
   tekrar başlatılmasını engellemek için kullanılır.) Artık backend
   sorgulaması içerdiği için Promise döner. */
async function herhangiUniteSikismadaMi(){
  const uniteler = await _uniteListesiGetir();
  return Object.keys(uniteler).some(function(kod){ return !!uniteler[kod].is_jammed; });
}

/* Ana makine açılıp kapandığında TÜM ezme/kırma ünitelerini backend
   üzerinden otomatik olarak başlatır ya da durdurur. index.html'deki
   makineGuncelle() fonksiyonu, ana makine her AÇIK/KAPALI olduğunda
   (yani PATCH /power başarılı olduğunda) bunu çağırmalı. */
async function tumUniteleriAyarla(acik){
  _sonGucDurumu = !!acik;
  const anahtarlar = Object.keys(uniteAyarlari);
  for (const anahtar of anahtarlar){
    const ayar = uniteAyarlari[anahtar];
    const birim = await birimDurumuYukle(ayar.sayacKey);
    const yerel = _yerelDurumYukle(ayar);

    if (acik){
      // Eğer ünite zaten sıkışmadaysa, makine açılsa bile çalışmaya başlamasın
      if (!birim.sikisma){
        try{ await uniteBaslat(anahtar); }catch(e){ console.error('[ezme] Ünite başlatılamadı:', ayar.backendKod, e); }
        yerel.yuk = rastgele(45, 60);
        yerel.sonIslemler.unshift({ zaman: saatStr(), text: 'Ana makineyle birlikte otomatik başlatıldı' });
      }
    } else {
      // Makine kapatıldığında ünite durdurulur (sıkışma durumu backend'de zaten korunuyor)
      try{ await uniteDurdur(anahtar); }catch(e){ console.error('[ezme] Ünite durdurulamadı:', ayar.backendKod, e); }
      yerel.yuk = 0;
      yerel.sonIslemler.unshift({
        zaman: saatStr(),
        text: birim.sikisma ? 'Ana makine kapatıldı (Sıkışma durumu korunuyor)' : 'Ana makineyle birlikte otomatik durduruldu'
      });
    }
    yerel.sonIslemler = yerel.sonIslemler.slice(0, 8);
    _yerelDurumKaydet(ayar, yerel);
  }
}