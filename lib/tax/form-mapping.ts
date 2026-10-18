/** Official 2026 paper form references for 2025/26. Engineering mapping, not tax sign-off. */
export const formMapping2025 = {
    id: 'uk-draft-forms-2025-26/3', tax_year_start: 2025, reviewed_at: '2026-10-18', review_status: 'official_sources_checked_independent_tax_review_pending',
    short_turnover_limit_pence: 9000000,
    sources: {
        SA100: 'https://assets.publishing.service.gov.uk/media/69c14d07cfa346b9d4704a8d/SA100-2026.pdf',
        SA102: 'https://assets.publishing.service.gov.uk/media/69bd6a7a7e02b81c0d1c75ae/SA102-2026.pdf',
        SA101: 'https://assets.publishing.service.gov.uk/media/69c25b9ab920af63be1c770c/SA101_2026.pdf',
        SA103S: 'https://assets.publishing.service.gov.uk/media/69c12ae013101e9908704a53/SA103S-2026.pdf',
        SA103F: 'https://assets.publishing.service.gov.uk/media/69c2635b13101e9908704b36/SA103F_2026.pdf',
        short_notes: 'https://assets.publishing.service.gov.uk/media/69ce15395cf899414a0bc69f/SA103S_Notes_2026.pdf',
        full_notes: 'https://assets.publishing.service.gov.uk/media/69c26565cfa346b9d4704b35/SA103F_Notes_2026.pdf',
    },
    boxes: { employment_pay: 'SA102:E1:1', employment_tax: 'SA102:E1:2', termination_taxable: 'SA101:Ai2:5', termination_tax: 'SA101:Ai2:6', termination_exempt: 'SA101:Ai2:9', ras_gross: 'SA100:TR4:1', ras_one_off: 'SA100:TR4:1.1', gift_aid_net: 'SA100:TR4:5', gift_aid_one_off: 'SA100:TR4:6' },
    short: { turnover: '9', allowance: '10.1', expenses: '20', profit: '21', loss: '22', tax_profit: '28', tax_loss: '32', taxable_profit: '31', capital: ['23', '24', '24.1', '25', '25.1', '25.2'] },
    full: { turnover: '15', allowance: '16.1', expenses: '31', profit: '47', loss: '48', add_backs: '46', capital_total: '57', net_tax_profit: '64', net_tax_loss: '65', adjusted_profit: '73', adjusted_loss: '77', taxable_profit: '76', capital: ['49', '50', '51', '52', '52.1', '53', '53.1', '54', '55', '56'] },
    cash_basis_car_capital: { short: ['24', '24.1', '25'], full: ['50', '51', '52.1', '56'] },
    full_expenses: { '17': 'Goods and materials', '18': 'Construction subcontracting', '19': 'Staff', '20': 'Vehicles and travel', '21': 'Premises and utilities', '22': 'Repairs', '23': 'Office and communications', '24': 'Promotion', '25': 'Finance interest', '26': 'Bank charges', '27': 'Bad debts', '28': 'Professional services', '29': 'Depreciation', '30': 'Other costs' },
    paper_rounding: 'Paper instructions use whole pounds: income down, expenses and tax paid up. Exact pence remain the calculation basis. Proposed paper totals require separate reconciliation; this is not an online submission format.',
} as const;

/** Frozen predecessor for reconstruction of earlier filing input contracts. */
export const formMapping2025Legacy = {
    ...formMapping2025, id: 'uk-draft-forms-2025-26/1', reviewed_at: '2026-10-17',
    short: { turnover: '9', allowance: '10.1', expenses: '20', profit: '21', loss: '22', tax_profit: '28', taxable_profit: '31', capital: ['23', '24', '24.1', '25', '25.1', '25.2'] },
    full: { turnover: '15', allowance: '16.1', expenses: '31', profit: '47', loss: '48', add_backs: '46', capital_total: '57', net_tax_profit: '64', adjusted_profit: '73', taxable_profit: '76', capital: ['49', '50', '51', '52', '52.1', '53', '53.1', '54', '55', '56'] },
} as const;
