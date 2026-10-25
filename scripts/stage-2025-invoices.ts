import { createAdminClient } from '../lib/supabase/admin.ts';

const userId = 'ed18c91e-926e-415b-ad1b-989b198edc92';
const salesCategoryId = 'f7214d0d-529c-461e-89e9-ba3dc1200fcd';

const invoices2025 = [
  {
    ref: "LP050325",
    date: "2025-06-09",
    client: "Lindley Productions",
    description: "AV Live stream Tech and general video live",
    amount: 1525.00,
    sourceFile: "Lindley 9-6-25 £1525.pdf"
  },
  {
    ref: "IJAD 050325",
    date: "2025-06-17",
    client: "IJAD",
    description: "AV Live stream Tech and general video live",
    amount: 1525.00,
    sourceFile: "IJAD 11-6-25 £1525.pdf"
  },
  {
    ref: "ER7725",
    date: "2025-07-07",
    client: "Elinor Rowlands",
    description: "Mentoring (3 sessions)",
    amount: 1200.00,
    sourceFile: "ER 7725 £1200.pdf"
  },
  {
    ref: "AAC10725",
    date: "2025-07-10",
    client: "Attenborough Arts Centre",
    description: "Barco 2850 CRT Monitor rental",
    amount: 700.00,
    sourceFile: "Attenborough Arts Centre 100725 525.pdf"
  },
  {
    ref: "ER16725",
    date: "2025-07-16",
    client: "Elinor Rowlands",
    description: "Fragments of Perception (4 sessions)",
    amount: 1600.00,
    sourceFile: "ER 16725 £1600.pdf"
  },
  {
    ref: "EL 250725",
    date: "2025-07-25",
    client: "Elinor Rowlands",
    description: "Mentoring (1.9 sessions)",
    amount: 760.00,
    sourceFile: "ER 25725 760.pdf"
  },
  {
    ref: "P25725",
    date: "2025-07-25",
    client: "Primary (Jade Foster)",
    description: "Live Streaming technician",
    amount: 275.00,
    sourceFile: "PRIMARY 270725 275.pdf"
  },
  {
    ref: "CF14825",
    date: "2025-08-14",
    client: "Samuel Taylor",
    description: "Videographer Documentation and Editing",
    amount: 700.00,
    sourceFile: "CF 14825 £700.pdf"
  },
  {
    ref: "GE14825",
    date: "2025-08-14",
    client: "Geraint Edwards",
    description: "Consultancy (1h 30m)",
    amount: 150.00,
    sourceFile: "GE 14825 £150.pdf"
  },
  {
    ref: "ER27825",
    date: "2025-08-27",
    client: "Elinor Rowlands",
    description: "Fragments of Perception delivery",
    amount: 1650.00,
    sourceFile: "ER 27825 £1600.pdf"
  },
  {
    ref: "Ox251125",
    date: "2025-11-25",
    client: "Oxcombe",
    description: "Tech consultation and setup",
    amount: 240.00,
    sourceFile: "Oxcome 251125.pdf"
  },
  {
    ref: "ST021225",
    date: "2025-12-02",
    client: "Samuel Taylor",
    description: "Video editing and export",
    amount: 250.00,
    sourceFile: "ST021225.pdf"
  },
  {
    ref: "LP011225",
    date: "2025-12-02",
    client: "Lindley Productions",
    description: "Sound design and mix",
    amount: 450.00,
    sourceFile: "LP011225.pdf"
  },
  {
    ref: "DN151225",
    date: "2025-12-15",
    client: "Dance4 / DN",
    description: "Sound technician services",
    amount: 350.00,
    sourceFile: "DN151225.pdf"
  },
  {
    ref: "Bon-060126",
    date: "2026-01-26",
    client: "Bonington Gallery",
    description: "Sony Cube Monitor installation",
    amount: 350.00,
    sourceFile: "Boninton Sony Cube 6126.pdf"
  },
  {
    ref: "NC130226",
    date: "2026-02-13",
    client: "Nottingham Contemporary",
    description: "AV technician support",
    amount: 275.00,
    sourceFile: "NC 130226.pdf"
  },
  {
    ref: "Ox130226",
    date: "2026-02-13",
    client: "Oxcombe",
    description: "Kiln camera and video setup",
    amount: 180.00,
    sourceFile: "Oxcome 130226.pdf"
  },
  {
    ref: "LP170326",
    date: "2026-03-17",
    client: "Lindley Productions",
    description: "Post production audio",
    amount: 315.00,
    sourceFile: "Lindley 17326 £315.pdf"
  },
  {
    ref: "BA180326",
    date: "2026-03-18",
    client: "Basel Abbas & Ruanne Abou-Rahme",
    description: "Audio editing and pre-mix",
    amount: 180.00,
    sourceFile: "BA RA 180326 180.pdf"
  },
  {
    ref: "TB190326",
    date: "2026-03-19",
    client: "T-Bone Productions",
    description: "Audio technical consultancy",
    amount: 1500.00,
    sourceFile: "TBONE Consultantcy 19326 1500.pdf"
  },
  {
    ref: "V190326",
    date: "2026-03-19",
    client: "Ventnor Productions",
    description: "Video editing and color grading",
    amount: 2400.00,
    sourceFile: "Vent19326 2400.pdf"
  },
  {
    ref: "BR180326",
    date: "2026-04-01",
    client: "Basel Abbas & Ruanne Abou-Rahme",
    description: "Audio File Preparation",
    amount: 180.00,
    sourceFile: "BARAR 10426 180.pdf"
  }
];

async function stage() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Could not initialize Supabase admin client");

  // Fetch or create clients
  const { data: existingClients } = await admin
    .from('clients')
    .select('id, name')
    .eq('user_id', userId);

  const clientMap = new Map<string, string>();
  for (const c of existingClients ?? []) {
    clientMap.set(c.name.trim().toLowerCase(), c.id);
  }

  // Ensure all clients exist
  const neededClients = Array.from(new Set(invoices2025.map(i => i.client)));
  for (const name of neededClients) {
    const key = name.trim().toLowerCase();
    if (!clientMap.has(key)) {
      const { data: newClient, error } = await admin
        .from('clients')
        .insert({ user_id: userId, name: name.trim() })
        .select('id, name')
        .single();
      if (newClient) {
        clientMap.set(key, newClient.id);
        console.log(`Created client: ${name}`);
      }
    }
  }

  // Check if any of these are already staged
  const { data: existingRecords } = await admin
    .from('financial_records')
    .select('id, source_reference, description')
    .eq('user_id', userId)
    .eq('tax_year_start', 2025);

  const existingDescriptions = new Set((existingRecords ?? []).map(r => r.description));

  const rowsToInsert = invoices2025
    .filter(inv => {
      const desc = `${inv.client} — ${inv.description} (Ref: ${inv.ref})`;
      return !existingDescriptions.has(desc);
    })
    .map(inv => {
      const clientId = clientMap.get(inv.client.trim().toLowerCase()) ?? null;
      return {
        user_id: userId,
        record_type: 'income',
        record_date: inv.date,
        description: `${inv.client} — ${inv.description} (Ref: ${inv.ref})`,
        amount: inv.amount,
        category_id: salesCategoryId,
        client_id: clientId,
        source_type: 'csv',
        source_reference: `2025/26 Historical Invoice: ${inv.sourceFile}`,
        status: 'draft',
      };
    });

  if (rowsToInsert.length === 0) {
    console.log("All 2025/26 invoices are already staged.");
    return;
  }

  const { data: inserted, error } = await admin
    .from('financial_records')
    .insert(rowsToInsert)
    .select('id, record_date, description, amount, status, tax_year_start, tax_quarter');

  if (error) {
    console.error('Error staging 2025 records:', error);
    return;
  }

  console.log(`Successfully staged ${inserted.length} records for 2025/26!`);
  let sum = 0;
  for (const r of inserted) {
    sum += Number(r.amount);
    console.log(`• ${r.record_date} | Tax Year: ${r.tax_year_start}/${String(r.tax_year_start + 1).slice(2)} Q${r.tax_quarter} | £${Number(r.amount).toFixed(2)} | ${r.description}`);
  }
  console.log(`Total Staged: £${sum.toFixed(2)} across ${inserted.length} invoices.`);
}

stage().catch(console.error);
