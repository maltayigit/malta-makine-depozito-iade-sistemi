/* ============================================================
   KAPAK AÇMA / KAPAMA MOTORLARI VERİ KAYNAĞI
   kapak-motor-durum.html bu dosyayı kullanır.

   Gerçek makine entegrasyonunda YAPILMASI GEREKEN:
   kapakMotorSimulateTick() içindeki rastgele üretimi, PLC/limit
   switch'lerden gelen gerçek kapak açık/kapalı sinyaliyle değiştirmek.
   ============================================================ */

const KAPAK_MOTOR_DEPO_KEY = 'kapakMotorDurumu';

/* Ana makine (index.html) en son AÇIK/KAPALI durumuna göre kapak
   motorlarını otomatik senkronize ettiğimizde bu anahtara o anki
   makine durumunu yazarız. Bir sonraki kontrolde makineAcik ile bu
   değer karşılaştırılır; sadece GERÇEKTEN DEĞİŞİKLİK olduysa otomatik
   aç/kapa tetiklenir. Böylece manuel test butonuyla değiştirilen bir
   kapak, makine durumu değişmediği sürece ezilmez. */
const KAPAK_MOTOR_MAKINE_SENKRON_KEY = 'kapakMotorMakineSenkron';

/* ============================================================
   KAPAK MOTOR LOGU
   Her aç/kapa olayı (manuel veya makineye bağlı otomatik) burada
   kayıt altına alınır. kapak-motor-durum.html sayfasının alt
   kısmındaki "Kapak Motor Logu" bölümü bu veriyi listeler.
   Bellek şişmesin diye en fazla KAPAK_MOTOR_LOG_MAX_KAYIT kadar
   kayıt tutulur; daha eskiler otomatik silinir (FIFO).
   ============================================================ */
const KAPAK_MOTOR_LOG_KEY = 'kapakMotorLog';
const KAPAK_MOTOR_LOG_MAX_KAYIT = 1000;

/* "gg.aa.yyyy ss:dd:ss" formatında okunabilir tarih+saat. */
function kapakMotorTarihSaatStr(d){
  d = d || new Date();
  const gun = String(d.getDate()).padStart(2,'0');
  const ay  = String(d.getMonth() + 1).padStart(2,'0');
  const yil = d.getFullYear();
  return gun + '.' + ay + '.' + yil + ' ' + kapakMotorSaatStr(d);
}

function kapakMotorLogOku(){
  try {
    const veri = JSON.parse(localStorage.getItem(KAPAK_MOTOR_LOG_KEY) || '[]');
    return Array.isArray(veri) ? veri : [];
  } catch (e){
    return [];
  }
}

/* kayit: { ts, zaman, kapakId, kapakIsim, islem, tip, makineDurumu } */
function kapakMotorLogEkle(kayit){
  const log = kapakMotorLogOku();
  log.push(kayit);
  while (log.length > KAPAK_MOTOR_LOG_MAX_KAYIT) log.shift();
  localStorage.setItem(KAPAK_MOTOR_LOG_KEY, JSON.stringify(log));
}

function kapakMotorLogTemizle(){
  localStorage.removeItem(KAPAK_MOTOR_LOG_KEY);
}

/* ÖRNEK İSİMLER — istediğiniz gibi düzenleyebilirsiniz. */
const kapakMotorListesi = [
  { id: 'km1', isim: '1. Sol Plastik Ezme Kapağı' },
  { id: 'km2', isim: '2. Sol Plastik Ezme Kapağı' },
  { id: 'km3', isim: '3. Cam Ezme Kapağı' },
  { id: 'km4', isim: '4. Cam Ezme Kapağı' },
  { id: 'km5', isim: '5. Teneke / Alüminyum Ezme Kapağı' },
  { id: 'km6', isim: '6. Sağ Plastik Ezme Kapağı' },
  { id: 'km7', isim: '7. Sağ Plastik Ezme Kapağı' },
  { id: 'km8', isim: '8. Bakım Paneli Kapağı' }
];

function kapakMotorSaatStr(d){
  d = d || new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
}

/* Kayıtlı durumu localStorage'dan okur; yoksa veya liste uzunluğu
   değiştiyse (isim listesi düzenlendiyse) sıfırdan üretir. */
function kapakMotorlariYukle(){
  const kayitli = JSON.parse(localStorage.getItem(KAPAK_MOTOR_DEPO_KEY) || 'null');
  if (Array.isArray(kayitli) && kayitli.length === kapakMotorListesi.length) return kayitli;

  const yeni = kapakMotorListesi.map(function(m){
    return {
      id: m.id,
      acik: false,
      sonIslem: 'Kapandı',
      sonIslemZamani: kapakMotorSaatStr(),
      sonIslemTs: Date.now()
    };
  });
  localStorage.setItem(KAPAK_MOTOR_DEPO_KEY, JSON.stringify(yeni));
  return yeni;
}

function kapakMotorlariKaydet(liste){
  localStorage.setItem(KAPAK_MOTOR_DEPO_KEY, JSON.stringify(liste));
}

/* Tek bir kapağın durumunu elle aç/kapa yapar (test/manuel müdahale). */
function kapakMotorDurumDegistir(id){
  const liste = kapakMotorlariYukle();
  const kapak = liste.find(function(k){ return k.id === id; });
  if (!kapak) return liste;

  const simdi = new Date();
  kapak.acik = !kapak.acik;
  kapak.sonIslem = kapak.acik ? 'Açıldı (Manuel)' : 'Kapandı (Manuel)';
  kapak.sonIslemZamani = kapakMotorSaatStr(simdi);
  kapak.sonIslemTs = simdi.getTime();
  kapakMotorlariKaydet(liste);

  const meta = kapakMotorListesi.find(function(m){ return m.id === id; });
  const makineAcik = JSON.parse(localStorage.getItem('makineAcik') || 'false');
  kapakMotorLogEkle({
    ts: simdi.getTime(),
    zaman: kapakMotorTarihSaatStr(simdi),
    kapakId: id,
    kapakIsim: meta ? meta.isim : id,
    islem: kapak.acik ? 'Açıldı' : 'Kapandı',
    tip: 'manuel',
    makineDurumu: makineAcik ? 'AÇIK' : 'KAPALI'
  });

  return liste;
}

/* ============================================================
   MAKİNE AÇIK/KAPALI DURUMUNA BAĞLI OTOMATİK AÇMA/KAPAMA
   index.html'deki "makineAcik" localStorage anahtarı makine
   toggle'landığında güncelleniyor. Burada bu anahtarı izleyip
   makine AÇILDIĞINDA tüm kapak motorlarını otomatik AÇIK,
   KAPANDIĞINDA otomatik KAPALI konuma alıyoruz.

   Manuel test butonu her zaman kullanılabilir kalır: bir kapak
   manuel değiştirildikten sonra, makine durumu tekrar DEĞİŞENE
   kadar o manuel durum korunur (üzerine otomatik yazma yapılmaz).
   ============================================================ */

/* Tüm kapak motorlarını verilen makine durumuna göre ayarlar.
   logKaydet=false verilirse (ör. sayfa ilk kez açılıp henüz hiç
   senkron kaydı yokken yapılan "sessiz" ilk hizalama) log kaydı
   düşülmez; true/varsayılan olduğunda ise gerçek bir makine geçişi
   olduğu için her zaman loglanır. */
function kapakMotorlariMakineDurumunaGoreAyarla(makineAcik, logKaydet){
  if (logKaydet === undefined) logKaydet = true;

  const liste = kapakMotorlariYukle();
  const simdi = new Date();
  const zaman = kapakMotorSaatStr(simdi);
  const ts = simdi.getTime();

  liste.forEach(function(k){
    k.acik = makineAcik;
    k.sonIslem = makineAcik ? 'Otomatik Açıldı (Makine AÇIK)' : 'Otomatik Kapandı (Makine KAPALI)';
    k.sonIslemZamani = zaman;
    k.sonIslemTs = ts;

    // Bu, gerçek bir makine AÇ/KAPA geçişinde çağrılır (bkz.
    // kapakMotorMakineSenkronKontrolEt), yani her seferinde her kapağa
    // otomatik bir aç/kapa KOMUTU verilmiş demektir — kapak o anda zaten
    // aynı durumdaysa bile (ör. daha önce manuel açılmışsa) komut
    // verildiği için log kaydı düşülür. Böylece "makine açılınca kapaklar
    // otomatik açıldı" olayı hiçbir zaman sessizce atlanmaz.
    if (logKaydet){
      const meta = kapakMotorListesi.find(function(m){ return m.id === k.id; });
      kapakMotorLogEkle({
        ts: ts,
        zaman: kapakMotorTarihSaatStr(simdi),
        kapakId: k.id,
        kapakIsim: meta ? meta.isim : k.id,
        islem: makineAcik ? 'Açıldı' : 'Kapandı',
        tip: 'otomatik',
        makineDurumu: makineAcik ? 'AÇIK' : 'KAPALI'
      });
    }
  });

  kapakMotorlariKaydet(liste);
  localStorage.setItem(KAPAK_MOTOR_MAKINE_SENKRON_KEY, JSON.stringify(makineAcik));
  return liste;
}

/* Makine durumu en son senkronize ettiğimiz değerden farklıysa
   (yani gerçekten bir AÇ/KAPA geçişi olduysa) kapak motorlarını
   otomatik ayarlar ve bunu loglar. Sayfa hiç senkronize edilmemişse
   (ilk açılış) mevcut makine durumuna sessizce hizalanır — bu bir
   gerçek geçiş olmadığı için log kaydı oluşturulmaz. Değişiklik
   olduysa true, olmadıysa false döner. */
function kapakMotorMakineSenkronKontrolEt(){
  const makineAcik = JSON.parse(localStorage.getItem('makineAcik') || 'false');
  const sonSenkron = JSON.parse(localStorage.getItem(KAPAK_MOTOR_MAKINE_SENKRON_KEY) || 'null');

  if (sonSenkron === null){
    kapakMotorlariMakineDurumunaGoreAyarla(makineAcik, false);
    return false;
  }

  if (sonSenkron !== makineAcik){
    kapakMotorlariMakineDurumunaGoreAyarla(makineAcik, true);
    return true;
  }
  return false;
}

/* Canlı simülasyon: her tick'te %50 ihtimalle rastgele bir kapağın
   durumunu değiştirir. Gerçek entegrasyonda PLC verisiyle değişecek. */
/* Canlı simülasyon devre dışı bırakıldı. Gerçek entegrasyonda PLC verisiyle değişecek. */
function kapakMotorSimulateTick(){
  const liste = kapakMotorlariYukle();
  return liste; // Hiçbir şeyi değiştirmeden mevcut listeyi döndürür
}