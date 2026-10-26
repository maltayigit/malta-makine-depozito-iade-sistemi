const { query } = require('./../db');
const ApiError = require('./errors');

/**
 * Kullanıcının rolüne göre "kendi kapsamındaki" makineleri filtrelemek
 * için WHERE koşulu ve parametre üretir.
 *   SUPER_ADMIN         -> kısıtlama yok
 *   COMPANY             -> machines.company_id = kullanıcının company_id'si
 *   MARKET              -> machines.market_id = kullanıcının market_id'si
 *                          VEYA machines.owner_user_id = kullanıcının kendisi
 *                          (bkz. aşağıdaki not — machines tablosunda bir
 *                          makineyi bir mağaza hesabına bağlayan İKİ ayrı
 *                          alan var, ikisi de kapsam vermeli)
 *   SERVICE_PERSONNEL   -> service_personnel_machines üzerinden atanan makineler
 *   GOV_AGENCY          -> kısıtlama yok (ulusal düzeyde, TÜM firmalara ait makineleri
 *                          salt-okunur görür; yazma işlemleri zaten role_permissions'da
 *                          bu role hiç verilmediği için route seviyesinde engellenir)
 *
 * NOT — DÜZELTİLEN HATA: machines.owner_user_id ("Mağaza Sahibi"; bkz.
 * makine-yonetimi.html'deki "Seçilen mağaza hesabı, 'Makinelerim'
 * sayfasında sadece bu makineyi görür" notu) daha önce burada HİÇ
 * kullanılmıyordu — sadece machines.market_id (kullanıcının KENDİ
 * market_id'si) kontrol ediliyordu. Bir admin bir makineyi bir mağaza
 * hesabına "Mağaza Sahibi" olarak atadığında, o hesabın kendi market_id'si
 * o makinenin market_id'siyle birebir eşleşmiyorsa makine GET /api/machines
 * ve GET /api/faults için tamamen görünmez kalıyordu — yani makine
 * "Makinelerim" sayfasına hiç düşmüyor, üzerindeki arıza da (kart zaten
 * listede olmadığı için) görünmüyordu. Artık iki yoldan biri yeterli.
 *
 * baseParamIndex: mevcut sorguda kaçıncı $N'den başlanacağını belirtir (1-index).
 * Dönüş: { clause: string, params: any[] }
 */
function machineScopeClause(user, baseParamIndex = 1) {
  switch (user.roleCode) {
    case 'SUPER_ADMIN':
      return { clause: 'TRUE', params: [] };
    case 'GOV_AGENCY':
      return { clause: 'TRUE', params: [] };
    case 'COMPANY':
      return { clause: `m.company_id = $${baseParamIndex}`, params: [user.companyId] };
    case 'MARKET':
      return {
        clause: `(m.market_id = $${baseParamIndex} OR m.owner_user_id = $${baseParamIndex + 1})`,
        params: [user.marketId, user.userId],
      };
    case 'SERVICE_PERSONNEL':
      return {
        clause: `m.machine_id IN (SELECT machine_id FROM service_personnel_machines WHERE user_id = $${baseParamIndex})`,
        params: [user.userId],
      };
    default:
      return { clause: 'FALSE', params: [] };
  }
}

/** Belirli bir machine_id'nin kullanıcının kapsamında olup olmadığını doğrular. */
async function assertMachineInScope(user, machineId) {
  const { clause, params } = machineScopeClause(user, 2);
  const { rows } = await query(
    `SELECT 1 FROM machines m WHERE m.machine_id = $1 AND (${clause}) AND m.deleted_at IS NULL LIMIT 1`,
    [machineId, ...params]
  );
  if (!rows.length) {
    throw ApiError.forbidden('Bu makineye erişim yetkiniz yok veya makine bulunamadı.');
  }
}

module.exports = { machineScopeClause, assertMachineInScope };