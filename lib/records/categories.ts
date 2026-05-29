import { type CsvCategory } from "@/lib/records/csv";
import { type RecordType } from "@/lib/records/validation";

type CategoryReadQuery = PromiseLike<{ data: unknown[] | null }> & {
  order: (column: string, options?: { ascending?: boolean }) => CategoryReadQuery;
};

type CategoryTable = {
  select: (columns: string) => {
    or: (query: string) => CategoryReadQuery;
  };
  insert: (values: unknown[]) => PromiseLike<{ error: unknown }>;
};

type SupabaseClient = {
  from: (table: string) => CategoryTable;
};

const DEFAULT_RECORD_CATEGORIES: Array<{
  name: string;
  record_type: RecordType;
  sa103_box: string;
}> = [
  { name: "Sales and fees", record_type: "income", sa103_box: "SA103 turnover" },
  {
    name: "Other business income",
    record_type: "income",
    sa103_box: "SA103 other business income",
  },
  {
    name: "Cost of goods bought for resale",
    record_type: "expense",
    sa103_box: "SA103 cost of goods",
  },
  { name: "Office costs", record_type: "expense", sa103_box: "SA103 office costs" },
  { name: "Travel costs", record_type: "expense", sa103_box: "SA103 travel costs" },
  { name: "Staff costs", record_type: "expense", sa103_box: "SA103 staff costs" },
  {
    name: "Subcontractor costs",
    record_type: "expense",
    sa103_box: "SA103 subcontractor costs",
  },
  {
    name: "Advertising and marketing",
    record_type: "expense",
    sa103_box: "SA103 advertising",
  },
  {
    name: "Professional fees",
    record_type: "expense",
    sa103_box: "SA103 professional fees",
  },
  {
    name: "Other allowable expenses",
    record_type: "expense",
    sa103_box: "SA103 other allowable expenses",
  },
];

export async function ensureRecordCategories(
  supabase: SupabaseClient,
  userId: string
): Promise<CsvCategory[]> {
  const existing = await readRecordCategories(supabase, userId);
  const hasIncome = existing.some((category) => category.record_type === "income");
  const hasExpense = existing.some((category) => category.record_type === "expense");

  if (hasIncome && hasExpense) {
    return existing;
  }

  const existingKeys = new Set(
    existing.map((category) => `${category.record_type}:${category.name.toLowerCase()}`)
  );
  const missing = DEFAULT_RECORD_CATEGORIES.filter((category) => {
    if (category.record_type === "income" && hasIncome) return false;
    if (category.record_type === "expense" && hasExpense) return false;
    return !existingKeys.has(`${category.record_type}:${category.name.toLowerCase()}`);
  });

  if (missing.length > 0) {
    await supabase.from("record_categories").insert(
      missing.map((category) => ({
        user_id: userId,
        name: category.name,
        record_type: category.record_type,
        sa103_box: category.sa103_box,
        is_default: false,
      }))
    );
  }

  return readRecordCategories(supabase, userId);
}

async function readRecordCategories(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("record_categories")
    .select("id, name, record_type")
    .or(`user_id.eq.${userId},is_default.eq.true`)
    .order("record_type", { ascending: true })
    .order("name", { ascending: true });

  return (data ?? []) as CsvCategory[];
}
