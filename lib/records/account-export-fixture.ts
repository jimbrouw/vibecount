// Synthetic rows only; not a database snapshot or recoverable backup.
import { ACCOUNT_EXPORT_FIELDS } from './account-export-fields';
import type { AccountExportData, AccountExportKey, AccountExportRow, AccountExportContext } from './account-export';
export function accountExportFixture() {
  const owner='11111111-1111-4111-8111-111111111111';
  const row=(key:AccountExportKey,id:string,patch:Record<string,unknown>={}):AccountExportRow=>({...Object.fromEntries(ACCOUNT_EXPORT_FIELDS[key].map(k=>[k,null])),id,user_id:owner,...patch});
  const raw:AccountExportData={
    settings:[row('settings',owner,{legal_name:'Synthetic owner',vat_rate:0,tax_pot_percentage:'27.00',statutory_interest_rate:13.25,bank_details:'PRIVATE_BANK',utr:'PRIVATE_UTR',companies_house_api_key:'PRIVATE_KEY',pdf_logo_path:'PRIVATE_LOGO'})],
    clients:[row('clients','client',{name:'Synthetic client',email:'customer@example.invalid'})],
    invoices:[row('invoices','invoice',{client_id:'client',origin:'native_gbp',currency:'GBP',amount:'120.00',status:'finalised',number:'NATIVE-120',description:'Payment to 12-34-56 account 12345678',economics_version:1,pdf_path:'PRIVATE_PDF',source_snapshot:{text:'PRIVATE_SOURCE'}})],
    financialRecords:[row('financialRecords','record',{record_type:'income',record_date:'2026-04-05',amount:30.01,effect_sign:-1,status:'approved',source_reference:'PRIVATE_SOURCE_REFERENCE'})],
    invoiceReminders:[row('invoiceReminders','reminder',{invoice_id:'invoice',client_id:'client',recipient_email:'customer@example.invalid',status:'pending',amount_due_pence:'9000',message:'PRIVATE_MESSAGE',error:'PRIVATE_PROVIDER_ERROR',provider_message_id:'PRIVATE_PROVIDER_ID'})],
    invoiceRevisions:[row('invoiceRevisions','revision',{invoice_id:'invoice',version:1,origin:'native_gbp',pdf_sha256:'a'.repeat(64),author:owner,snapshot:{bank_details:'PRIVATE_REVISION'},pdf_path:'PRIVATE_REVISION_PATH'})],
  };
  const context:AccountExportContext={stamp:'a'.repeat(64),counts:Object.fromEntries(Object.entries(raw).map(([k,rows])=>[k,rows.length])) as AccountExportContext['counts']};
  return{owner,raw,context};
}
