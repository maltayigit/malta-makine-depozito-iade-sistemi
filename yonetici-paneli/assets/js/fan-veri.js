/* ===============================================================================
   FAN KONTROL VERİ KAYNAĞI (fan-veri.js)
   Tüm fan durumları ve mantığı bu dosyada saklanır.
   ===============================================================================*/

   const fanListesi = [
    {id: 'fan1', ad: '1. Fan'},
    {id: 'fan2', ad: '2. Fan'},
    {id: 'fan3', ad: '3. Fan'},
    {id: 'fan4', ad: '4. Fan'},
   ];

   const FAN_DEPO_KEY = 'fanDurumlari';

   //Fan durumunu kaydet

   function fanDurumKaydet(fanId, durum) {
    const mevcut = JSON.parse(localStorage.getItem(FAN_DEPO_KEY) || '{}');
    mevcut[fanId] = durum; // true: açık false: kapalı
    localStorage.setItem(FAN_DEPO_KEY, JSON.stringify(mevcut));
   }

   // Tüm Fanların durumunu al 
   function fanDurumlariYukle() {
    return JSON.parse(localStorage.getItem(FAN_DEPO_KEY) || '{}');
   }

   // Makine kapandığında tüm fanları durdur (Güvenlik)
   function tumFanlariKapat() {
    const durumlar = {};
    fanListesi.forEach(f => durumlar[f.id] = false);
    localStorage.setItem(FAN_DEPO_KEY, JSON.stringify(durumlar));
   }

   // Ana makine açıldığında tüm fanları otomatik başlat.
   // Fanlar manuel olarak kontrol edilmez; her zaman ana makinenin durumunu takip eder.
   function tumFanlariAc() {
    const durumlar = {};
    fanListesi.forEach(f => durumlar[f.id] = true);
    localStorage.setItem(FAN_DEPO_KEY, JSON.stringify(durumlar));
   }