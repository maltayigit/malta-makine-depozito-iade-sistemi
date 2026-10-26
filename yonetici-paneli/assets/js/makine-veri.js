/* ============================================================
   MAKİNE VERİ KAYNAĞI — GERÇEK BACKEND SÜRÜMÜ
   Artık localStorage yerine gerçek API'den (PostgreSQL) veri çekiyor.
   auth.js bu dosyadan ÖNCE yüklenmiş olmalı (AUTH_API_BASE ve
   oturumAccessTokenGetir buradan kullanılıyor).
   ============================================================ */

async function apiIstek(yol, secenekler) {
  secenekler = secenekler || {};
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    secenekler.headers || {},
    { Authorization: 'Bearer ' + (oturumAccessTokenGetir() || '') }
  );
  const res = await fetch(AUTH_API_BASE + yol, Object.assign({}, secenekler, { headers: headers }));
  if (res.status === 401) {
    // Access token geçersiz/süresi dolmuş → oturumu kapat, login'e dön.
    if (typeof cikisYap === 'function') cikisYap();
    throw new Error('Oturum geçersiz, tekrar giriş yapmanız gerekiyor.');
  }
  if (res.status === 204) return null;
  const veri = await res.json().catch(function () { return null; });
  if (!res.ok) {
    const hata = new Error((veri && veri.message) || 'İstek başarısız (' + res.status + ')');
    hata.status = res.status;
    hata.body = veri;
    throw hata;
  }
  return veri;
}

// "AÇIK/KAPALI" göstergesi, makinenin ağ bağlantısını (online_status:
// ONLINE/OFFLINE — cihazın son ne zaman sinyal gönderdiğiyle ilgili) değil,
// gerçekten çalıştırılıp çalıştırılmadığını (machine_power_state.is_powered_on
// — index.html'deki aç/kapat anahtarının yazdığı değer) yansıtır. Backend
// GET /api/machines bunu artık is_powered_on alanı olarak JOIN'leyip döndürüyor.
function makineGucDurumuCevir(isPoweredOn) {
  return isPoweredOn ? 'acik' : 'kapali';
}

// "DD.MM.YYYY SS:DD" biçiminde okunabilir tarih.
function tarihStrCevir(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
    + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Backend'den makineleri VE açık arıza kayıtlarını çekip, sitenin geri
// kalanının (makineler.html, ariza-bildir.html) beklediği eski veri
// şekline (m.id, m.ad, m.sube, m.ariza, m.arizaAciklama...) dönüştürür.
// ARTIK ASENKRON — çağıran kodun 'await makineleriYukle()' kullanması gerekir.
async function makineleriYukle() {
  const [makineListesi, arizaListesi] = await Promise.all([
    apiIstek('/api/machines'),
    apiIstek('/api/faults?status=OPEN').catch(function () { return []; })
  ]);

  const arizalarMakineye = {};
  (arizaListesi || []).forEach(function (f) {
    if (!arizalarMakineye[f.machine_id]) arizalarMakineye[f.machine_id] = [];
    arizalarMakineye[f.machine_id].push({
      id: f.fault_id,
      aciklama: f.fault_description,
      tarih: tarihStrCevir(f.created_at)
    });
  });

  return (makineListesi || []).map(function (m) {
    const arizalar = arizalarMakineye[m.machine_id] || [];
    const enOnemli = arizalar.length ? arizalar[0] : null;
    return {
      id: m.machine_id,
      ad: m.display_name || ('Makine #' + m.machine_code),
      sube: m.market_name || m.company_name || '—',
      teknisyen: m.technician_full_name || 'Atanmadı',
      ozet: [
        'Kod: ' + m.machine_code + (m.firmware_version ? ' · v' + m.firmware_version : ''),
        m.fill_level != null ? 'Doluluk: %' + m.fill_level : 'Son görülme: ' + (m.last_seen_at ? tarihStrCevir(m.last_seen_at) : 'bilinmiyor')
      ],
      panel: 'index.html',
      durum: makineGucDurumuCevir(m.is_powered_on),
      ariza: !!m.is_faulty,
      arizaAciklama: enOnemli ? ((arizalar.length > 1 ? '(+' + (arizalar.length - 1) + ' diğer arıza) ' : '') + enOnemli.aciklama) : '',
      arizaTarihi: enOnemli ? enOnemli.tarih : '',
      arizalar: arizalar
    };
  });
}

// Backend zaten kullanıcının rolüne göre sadece görebileceği makineleri
// döndürüyor, bu yüzden burada ayrıca filtreleme gerekmiyor. Eski
// çağrılarla uyumlu kalması için fonksiyon korunuyor.
function goruntulenecekMakineler(liste) {
  return liste;
}

// Veri zaten API'den zenginleştirilmiş geldiği için ek işlem gerekmiyor.
function makineGercekVeriyleZenginlestir(m) {
  return m;
}

// Yeni bir arıza bildirir (ariza-bildir.html tarafından çağrılır).
async function arizaBildir(machineId, aciklamaTam) {
  return apiIstek('/api/faults', {
    method: 'POST',
    body: JSON.stringify({ machineId: machineId, faultDescription: aciklamaTam })
  });
}

// Bir arıza kaydını backend'de "RESOLVED" (çözüldü) olarak işaretler
// (bildirilen-arizalar.html tarafından çağrılır). Eski localStorage
// sürümündeki arizaSil()/makineleriKaydet() ikilisinin yerini alır —
// artık kayıt diziden silinmiyor, backend'deki durumu güncelleniyor.
async function arizaCozulduBildir(faultId) {
  return apiIstek('/api/faults/' + faultId, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'RESOLVED' })
  });
}