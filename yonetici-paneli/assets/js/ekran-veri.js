/* ============================================================
   EKRAN (TABLET) CANLILIK VERİ KAYNAĞI — ekran-veri.js
   ============================================================
   Amaç: Makine üzerindeki 4 fiziksel tablet/ekranın her biri,
   üzerinde AÇIK OLAN sayfa aracılığıyla düzenli aralıklarla
   "buradayım, çalışıyorum" sinyali (heartbeat) gönderir. Bu
   sayfa (ekran-durumu.html) o sinyalleri okuyarak her ekranın
   ÇEVRİMİÇİ / ÇEVRİMDIŞI (arızalı, donmuş, kapanmış, ağdan
   düşmüş vb.) olduğunu gösterir.

   NASIL KULLANILIR (her tablette açık kalan sayfaya eklenir):
   1) Sayfanın <head> veya </body> öncesine ekleyin (api-client.js,
      backend'e heartbeat gönderebilmek için auth.js'den SONRA,
      ekran-veri.js'den ÖNCE yüklenmiş olmalı; tabletin de o makineye
      giriş yapmış / 'aktifMakineId' seçili olması gerekir):
        <script src="auth.js"></script>
        <script src="api-client.js"></script>
        <script src="ekran-veri.js"></script>
   2) Hemen ardından, o ekrana ait KİMLİK ve GÖRÜNEN AD ile
      başlatın (her tablette FARKLI bir ekranId kullanın):
        <script>
          ekranHeartbeatBaslat('ekran1', '1. Tablet - Ana Panel');
        </script>
      Örnek 4 tablet için:
        ekran1 → ekranHeartbeatBaslat('ekran1', '1. Tablet');
        ekran2 → ekranHeartbeatBaslat('ekran2', '2. Tablet');
        ekran3 → ekranHeartbeatBaslat('ekran3', '3. Tablet');
        ekran4 → ekranHeartbeatBaslat('ekran4', '4. Tablet');
   3) İkinci parametredeki adı ("1. Tablet" gibi) dilediğiniz
      gibi değiştirebilirsiniz (örn. "Ana Panel", "Ezme Ünitesi
      Ekranı" vb.) — ekran-durumu.html bu adı olduğu gibi gösterir.

   NOT — ÖNEMLİ SINIRLAMA:
   Bu mekanizma tarayıcı localStorage'ına dayanır. localStorage
   sadece AYNI TARAYICI ÜZERİNDE, sekmeler/pencereler arasında
   paylaşılır. Eğer 4 tablet birbirinden FİZİKSEL OLARAK AYRI
   cihazlarsa (her birinin kendi tarayıcısı/kendi localStorage'ı
   varsa), bu 4 cihazın verisi TEK BİR ekran-durumu.html sayfasında
   otomatik olarak birleşmez — her cihazın verisi kendi içinde kalır.
   Gerçek çoklu-cihaz izleme için sinyallerin bir sunucuya
   (API/veritabanı) gönderilmesi gerekir. Şu an sistemin geri kalanı
   (ezme-veri.js, doluluk-veri.js) da aynı localStorage yaklaşımını
   kullandığından, bu dosya da mevcut mimariyle tutarlı ilerliyor;
   tabletler aynı yerel ağda ortak bir sunucu/API üzerinden veri
   paylaşacaksa demoVeriUret() mantığına benzer şekilde bu dosyanın
   ilerde bir API çağrısıyla değiştirilmesi yeterli olur.
   ============================================================ */

const EKRAN_DEPO_KEY = 'ekranDurumlari';

// Bir heartbeat'in "canlı" sayılması için üst sınır (ms).
// Heartbeat'ler 3 saniyede bir gönderilir; 8 saniye sinyal gelmezse
// ekran ÇEVRİMDIŞI kabul edilir (donma/kapanma/ağ kopması vb.).
const EKRAN_CEVRIMDISI_ESIK_MS = 8000;

// Varsayılan 4 ekran tanımı — dilediğiniz gibi ad değiştirebilir,
// ekleyip çıkarabilirsiniz. 'id' alanı ekranHeartbeatBaslat()'a
// verdiğiniz ekranId ile birebir eşleşmelidir.
const EKRAN_LISTESI = [
  { id: 'ekran1', varsayilanAd: '1. Tablet' },
  { id: 'ekran2', varsayilanAd: '2. Tablet' },
  { id: 'ekran3', varsayilanAd: '3. Tablet' },
  { id: 'ekran4', varsayilanAd: '4. Tablet' }
];

function ekranlariYukle(){
  try{ return JSON.parse(localStorage.getItem(EKRAN_DEPO_KEY) || '{}'); }
  catch(e){ return {}; }
}

function ekranlariKaydet(veri){
  try{ localStorage.setItem(EKRAN_DEPO_KEY, JSON.stringify(veri)); }catch(e){ /* sessizce geç */ }
}

// Heartbeat'i backend'e de gönderir (localStorage sadece aynı tarayıcı içinde
// paylaşılır; gerçek çoklu-cihaz izleme için bu API çağrısı gerekir — bkz.
// dosya başındaki NOT). api-client.js yüklenmemişse veya aktif bir makine
// seçilmemişse sessizce atlanır, localStorage yolu yine çalışmaya devam eder.
function ekranHeartbeatApiGonder(ekranId, sayfaYolu){
  if (typeof window.MaltaApi === 'undefined') return;
  const api = window.MaltaApi;
  const machineId = api.machineId();
  if (!machineId) return;
  api.request('/api/machines/' + encodeURIComponent(machineId) + '/screens/' + encodeURIComponent(ekranId) + '/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ page: sayfaYolu })
  }).catch(function(err){ console.warn('[ekran-veri] Heartbeat API\'ye gönderilemedi:', err.message); });
}

// Tek bir heartbeat (canlılık sinyali) gönderir.
function ekranHeartbeatGonder(ekranId, ekranAdi){
  const tumu = ekranlariYukle();
  const sayfaYolu = location.pathname.split('/').pop() || location.pathname;
  tumu[ekranId] = {
    ad: ekranAdi || ekranId,
    sonGorulme: Date.now(),
    sayfaBasligi: document.title || '',
    sayfaYolu: sayfaYolu
  };
  ekranlariKaydet(tumu);
  ekranHeartbeatApiGonder(ekranId, sayfaYolu);
}

// Bir tablette açık olan sayfaya eklenip çağrılır: hem anında hem de
// düzenli aralıklarla (3 sn) heartbeat göndermeye başlar.
function ekranHeartbeatBaslat(ekranId, ekranAdi){
  ekranHeartbeatGonder(ekranId, ekranAdi);
  setInterval(function(){ ekranHeartbeatGonder(ekranId, ekranAdi); }, 3000);

  // Sekme/pencere kapanmadan hemen önce de son bir sinyal göndermeyi
  // dene (garanti değildir, ama çoğu durumda çalışır).
  window.addEventListener('beforeunload', function(){
    ekranHeartbeatGonder(ekranId, ekranAdi);
  });
}

// Bir ekranın anlık durumunu hesaplar.
function ekranDurumHesapla(kayit){
  if (!kayit) return { key: 'hicgorulmedi', ad: 'Hiç Bağlanmadı' };
  const gecenMs = Date.now() - kayit.sonGorulme;
  if (gecenMs > EKRAN_CEVRIMDISI_ESIK_MS) return { key: 'cevrimdisi', ad: 'Çevrimdışı / Arızalı' };
  return { key: 'cevrimici', ad: 'Çalışıyor' };
}