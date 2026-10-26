/* =====================================================================
   backfill-default-units.js
   -----------------------------------------------------------------
   AMAÇ
   machines.routes.js -> DEFAULT_COMPARTMENTS / DEFAULT_UNITS /
   DEFAULT_SCREENS listelerine yeni bir kalem eklendiğinde (tıpkı
   'camKirma2' örneğinde olduğu gibi), bu listeler sadece YENİ
   oluşturulan makinelere otomatik uygulanır (provisionMachineDefaults).
   Var olan makineler eksik kalır ve bunun için elle bir migration
   yazmak gerekir.

   Bu script o adımı genelleştirir: DEFAULT_* listelerini tek doğru
   kaynak (machines.routes.js) olarak okuyup, silinmemiş her makinede
   eksik olan bölme/ünite/ekran kayıtlarını idempotent şekilde
   tamamlar. 'camKirma2' gibi tek seferlik migration'lara ihtiyaç
   kalmadan, ileride eklenecek her yeni varsayılan kalem için de
   çalışır.

   KULLANIM
     node src/scripts/backfill-default-units.js
     (veya package.json'a eklenen: npm run backfill:defaults)

   GÜVENLİK
   - Salt "eksik olanı ekler" mantığıyla çalışır; var olan hiçbir satırı
     UPDATE/DELETE etmez.
   - ON CONFLICT DO NOTHING ile idempotent'tir, güvenle tekrar tekrar
     çalıştırılabilir (örn. deploy sonrası bir sağlık kontrolü olarak).
   - Dry-run desteği: `--dry-run` bayrağıyla çalıştırılırsa hiçbir
     yazma yapmadan sadece hangi kayıtların ekleneceğini raporlar.
   ===================================================================== */

require('dotenv').config();
const { pool, withTransaction } = require('../db');
const { DEFAULT_COMPARTMENTS, DEFAULT_UNITS, DEFAULT_SCREENS } = require('../routes/machines.routes');

const DRY_RUN = process.argv.includes('--dry-run');

async function backfillCompartments(client, machineIds) {
  let added = 0;
  for (const machineId of machineIds) {
    for (const c of DEFAULT_COMPARTMENTS) {
      if (DRY_RUN) {
        const { rows } = await client.query(
          'SELECT 1 FROM machine_compartments WHERE machine_id = $1 AND compartment_code = $2',
          [machineId, c.code]
        );
        if (!rows.length) {
          console.log(`[dry-run] eklenecek: machine ${machineId} -> compartment '${c.code}'`);
          added++;
        }
        continue;
      }
      const { rowCount } = await client.query(
        `INSERT INTO machine_compartments (machine_id, compartment_code, display_name, unit, capacity)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (machine_id, compartment_code) DO NOTHING`,
        [machineId, c.code, c.name, c.unit, c.capacity]
      );
      added += rowCount;
    }
  }
  return added;
}

async function backfillUnits(client, machineIds) {
  let added = 0;
  for (const machineId of machineIds) {
    for (const u of DEFAULT_UNITS) {
      if (DRY_RUN) {
        const { rows } = await client.query(
          'SELECT 1 FROM machine_units WHERE machine_id = $1 AND unit_code = $2',
          [machineId, u.code]
        );
        if (!rows.length) {
          console.log(`[dry-run] eklenecek: machine ${machineId} -> unit '${u.code}'`);
          added++;
        }
        continue;
      }
      const { rowCount } = await client.query(
        `INSERT INTO machine_units (machine_id, unit_code, display_name)
         VALUES ($1,$2,$3) ON CONFLICT (machine_id, unit_code) DO NOTHING`,
        [machineId, u.code, u.name]
      );
      added += rowCount;
    }
  }
  return added;
}

async function backfillScreens(client, machineIds) {
  let added = 0;
  for (const machineId of machineIds) {
    for (const s of DEFAULT_SCREENS) {
      if (DRY_RUN) {
        const { rows } = await client.query(
          'SELECT 1 FROM machine_screens WHERE machine_id = $1 AND screen_code = $2',
          [machineId, s.code]
        );
        if (!rows.length) {
          console.log(`[dry-run] eklenecek: machine ${machineId} -> screen '${s.code}'`);
          added++;
        }
        continue;
      }
      const { rowCount } = await client.query(
        `INSERT INTO machine_screens (machine_id, screen_code, display_name)
         VALUES ($1,$2,$3) ON CONFLICT (machine_id, screen_code) DO NOTHING`,
        [machineId, s.code, s.name]
      );
      added += rowCount;
    }
  }
  return added;
}

async function run() {
  const client = await pool.connect();
  try {
    const { rows: machines } = await client.query('SELECT machine_id FROM machines WHERE deleted_at IS NULL');
    const machineIds = machines.map((m) => m.machine_id);

    if (!machineIds.length) {
      console.log('[backfill] Silinmemiş makine bulunamadı, yapılacak bir şey yok.');
      return;
    }

    console.log(`[backfill] ${machineIds.length} makine kontrol ediliyor${DRY_RUN ? ' (DRY RUN — hiçbir yazma yapılmayacak)' : ''}...`);

    const exec = async (fn) => (DRY_RUN ? fn(client, machineIds) : withTransaction((tx) => fn(tx, machineIds)));

    const compartmentsAdded = await exec(backfillCompartments);
    const unitsAdded = await exec(backfillUnits);
    const screensAdded = await exec(backfillScreens);

    console.log('[backfill] Tamamlandı.');
    console.log(`  - Bölme (compartment) eklendi : ${compartmentsAdded}`);
    console.log(`  - Ünite (unit) eklendi         : ${unitsAdded}`);
    console.log(`  - Ekran (screen) eklendi        : ${screensAdded}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[backfill] HATA:', err.message);
  process.exit(1);
});