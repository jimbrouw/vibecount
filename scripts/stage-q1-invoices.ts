import { createAdminClient } from '../lib/supabase/admin.ts';

const userId = 'ed18c91e-926e-415b-ad1b-989b198edc92';
const salesCategoryId = 'f7214d0d-529c-461e-89e9-ba3dc1200fcd';

const q1Invoices = [
  {
    ref: "ER-180326-1000",
    date: "2026-04-15",
    client: "Elinor Rowlands",
    description: "Fragments of Perception delivery RCA & Access to Work prep",
    amount: 1000.00
  },
  {
    ref: "ER-180326-625",
    date: "2026-04-15",
    client: "Elinor Rowlands",
    description: "Access to work support VR experience sequences",
    amount: 625.00
  },
  {
    ref: "P25426",
    date: "2026-04-24",
    client: "Primary (Jade Foster)",
    description: "Jan - April Pre-Production & Admin",
    amount: 1546.96
  },
  {
    ref: "ER25426-375",
    date: "2026-04-25",
    client: "Elinor Rowlands",
    description: "Access to work support",
    amount: 200.00
  },
  {
    ref: "ER25426-200",
    date: "2026-04-29",
    client: "Elinor Rowlands",
    description: "Attended Pioneering Tomorrow event",
    amount: 200.00
  },
  {
    ref: "VC-2026-0001",
    date: "2026-05-26",
    client: "Elinor Rowlands",
    description: "VR headset equipment",
    amount: 350.00
  },
  {
    ref: "VC-2026-0002",
    date: "2026-05-27",
    client: "Elinor Rowlands",
    description: "Tech setup & equipment",
    amount: 250.55
  },
  {
    ref: "JB-2026-0007",
    date: "2026-07-01",
    client: "T-Bone Productions",
    description: "Specialized Podcast edit (Tarmac SL9)",
    amount: 700.00
  },
  {
    ref: "JB-2026-0008",
    date: "2026-07-01",
    client: "Lindley Productions",
    description: "Press conference Tech Trent Bridge (England v NZ)",
    amount: 650.00
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

  // Ensure "Primary (Jade Foster)" exists
  if (!clientMap.has("primary (jade foster)")) {
    const { data: newClient } = await admin
      .from('clients')
      .insert({ user_id: userId, name: "Primary (Jade Foster)" })
      .select('id, name')
      .single();
    if (newClient) clientMap.set(newClient.name.trim().toLowerCase(), newClient.id);
  }

  const rowsToInsert = q1Invoices.map((inv) => {
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
      source_reference: 'Q1 2026/27 Historical Invoice Backfill',
      status: 'draft',
    };
  });

  const { data: inserted, error } = await admin
    .from('financial_records')
    .insert(rowsToInsert)
    .select('id, record_date, description, amount, status, tax_year_start, tax_quarter');

  if (error) {
    console.error('Error staging records:', error);
    return;
  }

  console.log(`Successfully staged ${inserted.length} records!`);
  for (const r of inserted) {
    console.log(`• ${r.record_date} | Tax Year: ${r.tax_year_start}/${String(r.tax_year_start + 1).slice(2)} Q${r.tax_quarter} | £${Number(r.amount).toFixed(2)} | Status: ${r.status}`);
  }
}

stage().catch(console.error);
