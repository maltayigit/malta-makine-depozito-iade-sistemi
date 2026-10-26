/* ============================================================
   KAMERA VERİ KAYNAĞI
   kamera-durum.html bu dosyayı kullanır.
   Bu dosya ezme-veri.js'in ARDINDAN yüklenmelidir; birimDurumuYukle,
   birimDurumuKaydet, rastgele ve saatStr fonksiyonlarını oradan miras alır.

   ============================================================
   ÖNEMLİ — GERÇEK KAMERA ENTEGRASYONU:
   Kamera markası/modeli henüz belli olmadığı için aşağıdaki
   `kameraListesi` içindeki `streamUrl` ve `streamTuru` alanları
   ÖRNEK/BOŞ olarak bırakılmıştır. Gerçek kameralar belli olduğunda:

   1) streamTuru'nu kameranın verdiği formata göre ayarlayın:
      - 'mjpeg' : http://kamera-ip/video gibi bir MJPEG akışıysa
                  (tarayıcı bunu doğrudan <img> ile oynatabilir)
      - 'hls'   : .m3u8 uzantılı bir HLS linkiyse
                  (bu sayfa hls.js ile oynatır)
      - 'rtsp'  : rtsp://... ile başlıyorsa, TARAYICI BUNU DOĞRUDAN
                  OYNATAMAZ. Bir dönüştürücü/proxy sunucu gerekir
                  (ör. MediaMTX, go2rtc, ffmpeg ile RTSP->HLS çevrimi).
                  Proxy kurulana kadar bu sayfa sadece bir uyarı ve
                  (varsa) periyodik anlık görüntü (snapshotUrl) gösterir.
   2) streamUrl'e kameranın gerçek adresini yazın.
   3) Depolama/sinyal/kayıt bilgileri şu an simüle ediliyor
      (simulateKameraTick). Gerçek bir NVR/kamera API'si bağlanınca
      bu fonksiyonun içini o API'den gelen veriyle değiştirin.
   ============================================================ */

const kameraListesi = [
  {
    id: 'kamera1',
    isim: 'Giriş Kamerası',
    konum: 'Ana Giriş',
    streamTuru: 'mjpeg',      // 'mjpeg' | 'hls' | 'rtsp'
    streamUrl: '',            // ör: 'http://192.168.1.50/video'
    snapshotUrl: '',          // rtsp seçildiğinde periyodik anlık görüntü adresi (opsiyonel)
    sayacKey: 'kamera1State'
  },
  {
    id: 'kamera2',
    isim: 'Makine Salonu Kamerası',
    konum: 'Üretim Alanı',
    streamTuru: 'mjpeg',
    streamUrl: '',
    snapshotUrl: '',
    sayacKey: 'kamera2State'
  },
  {
    id: 'kamera3',
    isim: 'Depo Kamerası',
    konum: 'Depo',
    streamTuru: 'mjpeg',
    streamUrl: '',
    snapshotUrl: '',
    sayacKey: 'kamera3State'
  },
  {
    id: 'kamera4',
    isim: 'Dış Cephe Kamerası',
    konum: 'Bahçe / Dış Alan',
    streamTuru: 'mjpeg',
    streamUrl: '',
    snapshotUrl: '',
    sayacKey: 'kamera4State'
  }
];

/* Bir kamera için sıfırdan varsayılan durum üretir. */
function varsayilanKameraDurumu(){
  return {
    online: true,
    kayitYapiyor: true,
    depolamaYuzde: rastgele(35, 65),
    sinyal: rastgele(75, 100),
    sonGuncelleme: saatStr()
  };
}

/* Sinyal yüzdesine göre etiket/renk sınıfı döner. */
function sinyalDurumu(sinyal){
  if (sinyal >= 70) return { key: 'iyi', ad: 'İyi' };
  if (sinyal >= 40) return { key: 'orta', ad: 'Orta' };
  return { key: 'zayif', ad: 'Zayıf' };
}

/* ── Canlı simülasyon: depolama/sinyal/online-offline/kayıt durumu ──────
   Gerçek entegrasyonda bu fonksiyonun içi NVR/kamera API'sinden gelen
   veriyle değiştirilecek; kamera kartlarının kendisi değişmeyecek. */
function simulateKameraTick(){
  kameraListesi.forEach(function(kamera){
    const durum = birimDurumuYukle(kamera.sayacKey, varsayilanKameraDurumu());

    // %2 ihtimalle bağlantı durumu değişsin (kısa kesintileri simüle eder)
    if (Math.random() < 0.02){
      durum.online = !durum.online;
    }

    if (durum.online){
      // Depolama zamanla yavaşça dolar; %98'e ulaşınca eski kayıtların
      // üzerine yazılmaya başlandığını simüle etmek için sıfırlanır.
      durum.depolamaYuzde += rastgele(0, 1);
      if (durum.depolamaYuzde >= 98) durum.depolamaYuzde = rastgele(20, 35);

      durum.sinyal = Math.max(20, Math.min(100, durum.sinyal + rastgele(-6, 6)));
      durum.kayitYapiyor = true;
    } else {
      // Bağlantı yoksa kayıt da, sinyal de düşer.
      durum.kayitYapiyor = false;
      durum.sinyal = 0;
    }

    durum.sonGuncelleme = saatStr();
    birimDurumuKaydet(kamera.sayacKey, durum);
  });
}