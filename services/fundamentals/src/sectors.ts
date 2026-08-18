/** Per-sector ratio templates + realistic supplier/vendor/buyer name pools. */

export interface SectorTemplate {
  pe: [number, number];
  pb: [number, number];
  roe: [number, number];
  netMargin: [number, number];
  grossMargin: [number, number];
  revenueGrowth: [number, number];
  debtToEquity: [number, number];
  currentRatio: [number, number];
  dividendYield: [number, number];
  beta: [number, number];
  employeeRevenueCr: [number, number]; // revenue per employee (INR crores)
  promoter: [number, number];
  fii: [number, number];
}

export const SECTOR_TEMPLATES: Record<string, SectorTemplate> = {
  IT: {
    pe: [18, 34], pb: [5, 12], roe: [22, 42], netMargin: [14, 24], grossMargin: [28, 45],
    revenueGrowth: [4, 12], debtToEquity: [0.01, 0.12], currentRatio: [2, 4],
    dividendYield: [0.8, 2.2], beta: [0.75, 1.1], employeeRevenueCr: [0.45, 0.85],
    promoter: [48, 75], fii: [12, 30],
  },
  Banking: {
    pe: [10, 22], pb: [1.4, 4.2], roe: [12, 22], netMargin: [12, 30], grossMargin: [55, 75],
    revenueGrowth: [6, 16], debtToEquity: [4, 9], currentRatio: [1.2, 2],
    dividendYield: [0.5, 1.8], beta: [1.0, 1.35], employeeRevenueCr: [1.2, 2.5],
    promoter: [20, 60], fii: [8, 25],
  },
  FMCG: {
    pe: [35, 60], pb: [8, 20], roe: [18, 35], netMargin: [10, 18], grossMargin: [40, 60],
    revenueGrowth: [5, 14], debtToEquity: [0.05, 0.4], currentRatio: [1.5, 2.5],
    dividendYield: [1.2, 3], beta: [0.5, 0.8], employeeRevenueCr: [0.8, 2],
    promoter: [40, 70], fii: [8, 22],
  },
  Auto: {
    pe: [16, 30], pb: [3, 7], roe: [12, 24], netMargin: [6, 12], grossMargin: [22, 32],
    revenueGrowth: [5, 16], debtToEquity: [0.2, 0.8], currentRatio: [1, 1.6],
    dividendYield: [0.8, 2], beta: [0.9, 1.3], employeeRevenueCr: [0.5, 1],
    promoter: [40, 65], fii: [10, 28],
  },
  Pharma: {
    pe: [22, 42], pb: [4, 9], roe: [14, 28], netMargin: [12, 22], grossMargin: [55, 70],
    revenueGrowth: [6, 14], debtToEquity: [0.1, 0.5], currentRatio: [1.5, 3],
    dividendYield: [0.5, 1.8], beta: [0.7, 1.05], employeeRevenueCr: [0.3, 0.6],
    promoter: [40, 70], fii: [8, 22],
  },
  Metals: {
    pe: [7, 16], pb: [1.2, 3], roe: [10, 25], netMargin: [6, 14], grossMargin: [18, 30],
    revenueGrowth: [4, 18], debtToEquity: [0.4, 1.2], currentRatio: [1, 1.8],
    dividendYield: [1.5, 4], beta: [1.2, 1.55], employeeRevenueCr: [0.3, 0.7],
    promoter: [35, 60], fii: [6, 18],
  },
  Energy: {
    pe: [7, 14], pb: [1, 2.6], roe: [10, 20], netMargin: [5, 12], grossMargin: [25, 40],
    revenueGrowth: [4, 12], debtToEquity: [0.4, 1.2], currentRatio: [0.8, 1.4],
    dividendYield: [2.5, 5.5], beta: [0.8, 1.1], employeeRevenueCr: [1, 2.5],
    promoter: [45, 75], fii: [5, 15],
  },
  Power: {
    pe: [8, 18], pb: [1.2, 3], roe: [8, 16], netMargin: [8, 18], grossMargin: [30, 45],
    revenueGrowth: [3, 12], debtToEquity: [1, 2.5], currentRatio: [0.8, 1.5],
    dividendYield: [1.5, 4], beta: [0.7, 1], employeeRevenueCr: [2, 4],
    promoter: [50, 75], fii: [5, 15],
  },
  Cement: {
    pe: [18, 35], pb: [2.5, 6], roe: [10, 18], netMargin: [8, 15], grossMargin: [25, 38],
    revenueGrowth: [4, 12], debtToEquity: [0.3, 0.9], currentRatio: [1, 1.8],
    dividendYield: [0.5, 1.8], beta: [0.9, 1.2], employeeRevenueCr: [0.4, 0.8],
    promoter: [50, 75], fii: [8, 20],
  },
  Financials: {
    pe: [15, 30], pb: [2, 5], roe: [12, 24], netMargin: [15, 30], grossMargin: [45, 65],
    revenueGrowth: [8, 22], debtToEquity: [3, 7], currentRatio: [1.2, 2],
    dividendYield: [0.3, 1.2], beta: [1.0, 1.3], employeeRevenueCr: [1, 2.2],
    promoter: [40, 65], fii: [10, 25],
  },
  Telecom: {
    pe: [18, 55], pb: [3, 7], roe: [6, 18], netMargin: [5, 18], grossMargin: [40, 55],
    revenueGrowth: [8, 18], debtToEquity: [1.5, 4], currentRatio: [0.6, 1.2],
    dividendYield: [0, 1], beta: [0.8, 1.1], employeeRevenueCr: [0.5, 1],
    promoter: [45, 70], fii: [8, 20],
  },
  Consumer: {
    pe: [30, 55], pb: [8, 18], roe: [18, 32], netMargin: [8, 15], grossMargin: [35, 50],
    revenueGrowth: [6, 15], debtToEquity: [0.1, 0.4], currentRatio: [1.4, 2.4],
    dividendYield: [0.8, 2], beta: [0.6, 0.9], employeeRevenueCr: [1.2, 2.8],
    promoter: [45, 70], fii: [8, 22],
  },
  'Capital Goods': {
    pe: [22, 40], pb: [4, 8], roe: [12, 22], netMargin: [6, 12], grossMargin: [20, 30],
    revenueGrowth: [8, 20], debtToEquity: [0.2, 0.6], currentRatio: [1.2, 2],
    dividendYield: [0.8, 2], beta: [1.0, 1.25], employeeRevenueCr: [0.4, 0.9],
    promoter: [50, 75], fii: [10, 25],
  },
  Infrastructure: {
    pe: [15, 30], pb: [2, 5], roe: [8, 16], netMargin: [8, 16], grossMargin: [30, 45],
    revenueGrowth: [6, 18], debtToEquity: [0.6, 1.6], currentRatio: [1, 1.6],
    dividendYield: [1, 2.5], beta: [0.9, 1.2], employeeRevenueCr: [0.6, 1.2],
    promoter: [55, 80], fii: [6, 18],
  },
  Healthcare: {
    pe: [28, 50], pb: [5, 10], roe: [10, 20], netMargin: [6, 14], grossMargin: [30, 42],
    revenueGrowth: [8, 18], debtToEquity: [0.2, 0.6], currentRatio: [1.4, 2.5],
    dividendYield: [0.3, 1.2], beta: [0.7, 1], employeeRevenueCr: [0.2, 0.5],
    promoter: [40, 65], fii: [8, 22],
  },
  Insurance: {
    pe: [15, 28], pb: [2.5, 5.5], roe: [8, 16], netMargin: [4, 10], grossMargin: [25, 40],
    revenueGrowth: [8, 18], debtToEquity: [1, 3], currentRatio: [1, 1.8],
    dividendYield: [0.3, 1], beta: [0.9, 1.2], employeeRevenueCr: [1, 2],
    promoter: [45, 70], fii: [10, 25],
  },
  Defence: {
    pe: [40, 80], pb: [7, 15], roe: [10, 18], netMargin: [10, 18], grossMargin: [30, 45],
    revenueGrowth: [10, 22], debtToEquity: [0.05, 0.3], currentRatio: [1.5, 3],
    dividendYield: [0.3, 1], beta: [1.1, 1.5], employeeRevenueCr: [0.3, 0.6],
    promoter: [60, 80], fii: [4, 12],
  },
  Travel: {
    pe: [25, 50], pb: [4, 9], roe: [8, 16], netMargin: [5, 12], grossMargin: [25, 40],
    revenueGrowth: [6, 18], debtToEquity: [0.3, 1], currentRatio: [0.8, 1.6],
    dividendYield: [0, 1], beta: [1.0, 1.4], employeeRevenueCr: [0.4, 0.8],
    promoter: [45, 70], fii: [8, 20],
  },
  Conglomerate: {
    pe: [18, 35], pb: [3, 7], roe: [10, 20], netMargin: [6, 12], grossMargin: [28, 40],
    revenueGrowth: [5, 15], debtToEquity: [0.4, 1.2], currentRatio: [1, 1.8],
    dividendYield: [0.8, 2], beta: [0.9, 1.2], employeeRevenueCr: [0.5, 1.2],
    promoter: [45, 70], fii: [6, 20],
  },
};

export const SECTOR_POOLS: Record<string, { suppliers: string[]; vendors: string[]; buyers: string[]; subsidiaries: string[] }> = {
  IT: {
    suppliers: ['Persistent Systems', 'Mphasis', 'Cyient', 'Coforge', 'Zensar Technologies', 'KPIT Technologies', 'Happiest Minds', 'Birlasoft'],
    vendors: ['Dell Technologies', 'AWS India', 'Microsoft India', 'ServiceNow', 'Salesforce India', 'SAP Labs', 'Cisco Systems India', 'Oracle India'],
    buyers: ['Bank of America', 'Citigroup', 'JPMorgan Chase', 'Shell', 'General Electric', 'Airbus', 'HSBC', 'Lloyds Bank', 'Walmart', 'Unilever'],
    subsidiaries: ['TCS BPS', 'Infosys BPM', 'Digital Engineering', 'Cloud Factory'],
  },
  Banking: {
    suppliers: ['TCS', 'Infosys', 'Wipro', 'Tech Mahindra', 'Mastek', 'Intellect Design Arena', 'FIS India', 'Tata Communications'],
    vendors: ['RBI', 'SIDBI', 'NABARD', 'NSDL', 'CDSL', 'National Payments Corp (NPCI)', 'SBI Cards'],
    buyers: ['Retail Depositors', 'MSME Lending', 'Corporate Clients', 'NBFC Partners', 'Credit Card Users'],
    subsidiaries: ['Digital Banking', 'Wealth Management', 'Asset Management', 'Insurance Arm'],
  },
  Energy: {
    suppliers: ['Larsen & Toubro', 'Bharat Heavy Electricals', 'ONGC Videsh', 'Gujarat State Petronet', 'Essar Projects', 'Technip India'],
    vendors: ['Shipping Corp of India', 'Indian Oil', 'BPCL', 'HPCL', 'Petronet LNG', 'GAIL India'],
    buyers: ['Power Plants', 'Refineries', 'Petrochemical Units', 'Fertilizer Plants', 'State PSUs'],
    subsidiaries: ['Exploration Unit', 'Marketing Arm', 'LNG Terminal', 'Petchem Division'],
  },
  FMCG: {
    suppliers: ['Parle Products', 'Godrej Consumer', 'Marico', 'Emami', 'Dabur India', 'Colgate India', 'Britannia'],
    vendors: ['Radico Khaitan', 'United Spirits', 'ITC Agri', 'Ruchi Soya', 'Adani Wilmar'],
    buyers: ['Reliance Retail', 'DMart', 'Big Bazaar', 'Metro Cash & Carry', 'Kirana Distributors', 'Amazon India', 'Flipkart'],
    subsidiaries: ['Personal Care', 'Foods Division', 'Home Care', 'Refreshment'],
  },
  Auto: {
    suppliers: ['Motherson Sumi', 'Bosch India', 'Bharat Forge', 'Wheels India', 'MRF', 'Apollo Tyres', 'Sona BLW', 'Tata AutoComp'],
    vendors: ['Mahindra Logistics', 'TVS Supply Chain', 'Allcargo Logistics', 'GATI-KWE'],
    buyers: ['Passenger Vehicle Retail', 'Commercial Fleets', 'Export Markets', 'OEM Dealerships', 'Cab Aggregators'],
    subsidiaries: ['Electric Vehicles', 'Financial Services', 'Defence Vehicles', 'Spare Parts'],
  },
  Pharma: {
    suppliers: ['Aurobindo Pharma', 'Lupin', 'Torrent Pharma', 'Glenmark', 'Alembic Pharma', 'Piramal Pharma', 'Laurus Labs', 'Divis Labs'],
    vendors: ['Granules India', 'Shilpa Medicare', 'Neuland Labs', 'Suven Pharma', 'Aarti Drugs'],
    buyers: ['US FDA Market', 'European Generics', 'Indian Hospitals', 'Cipla Med Ventures', 'GOVT Health Programs'],
    subsidiaries: ['Active Ingredients', 'Formulations', 'Biologics', 'Consumer Health'],
  },
  Metals: {
    suppliers: ['Vedanta', 'Hindustan Zinc', 'NMDC', 'MOIL', 'Coal India', 'Odisha Mining', 'Baldota Group'],
    vendors: ['Jindal Steel', 'SAIL', 'RINL', 'ArcelorMittal India', 'Kalyani Steel', 'Ratnamani Metals'],
    buyers: ['Construction Sector', 'Auto OEMs', 'L&T', 'Railway Coaches', 'Defence Manufacturing', 'Export Markets'],
    subsidiaries: ['Mining Arm', 'Ferro Alloys', 'Tube Division', 'Special Steels'],
  },
  Power: {
    suppliers: ['BHEL', 'Thermax', 'Siemens Energy India', 'GE Power India', 'Tata Projects', 'L&T Construction'],
    vendors: ['Power Grid Corp', 'Siemens India', 'ABB India', 'CG Power', 'Hitachi Energy'],
    buyers: ['Discoms (State)', 'Industrial Captives', 'Railways', 'Metro Systems', 'Rural Electrification'],
    subsidiaries: ['Renewables', 'Distribution', 'Transmission', 'Solar EPC'],
  },
  Cement: {
    suppliers: ['Jaypee Cement', 'Shree Cement', 'Ambuja Cements', 'ACC', 'Dalmia Bharat', 'J.K. Cement', 'Nuvoco Vistas'],
    vendors: ['Mepco', 'TIL Logistics', 'Ashok Leyland Fleet', 'Gujarat Sidhee', 'Sri Chamundeswari'],
    buyers: ['L&T', 'Housing Developers', 'Infra Projects', 'Ready-Mix Plants', 'Retail Builders'],
    subsidiaries: ['Ready-Mix Concrete', 'Clinker Unit', 'Packaging', 'Logistics'],
  },
  Financials: {
    suppliers: ['TCS', 'Infosys', 'Wipro', 'LTI Mindtree', 'Nucleus Software', 'Majesco', 'FIS Global'],
    vendors: ['NSDL', 'CDSL', 'CRISIL', 'ICRA', 'CARE Ratings', 'Experian India'],
    buyers: ['Consumer Finance', 'Vehicle Loans', 'Home Loans', 'MSME Loans', 'Gold Loans'],
    subsidiaries: ['Lending Arm', 'Wealth Management', 'General Insurance', 'Housing Finance'],
  },
  Telecom: {
    suppliers: ['Nokia India', 'Ericsson India', 'Huawei India', 'ZTE India', 'Sterlite Tech', 'Tejas Networks', 'HFCL'],
    vendors: ['TowerCos (Indus/ATC)', 'Bharti Infratel', 'Vodafone Idea', 'Reliance Jio', 'Tata Tele'],
    buyers: ['Retail Subscribers', 'Enterprise Clients', 'OTT Platforms', 'IoT Solutions', 'B2B Connectivity'],
    subsidiaries: ['Enterprise Services', 'Data Centres', 'Broadband', 'Tower Business'],
  },
  Consumer: {
    suppliers: ['Titan Suppliers', 'Kalyan Jewellers', 'PN Gadgil', 'Rajesh Exports', 'PC Jeweller', 'Vaibhav Global'],
    vendors: ['Aditya Birla Retail', 'Shopper\'s Stop', 'Tata CLiQ', 'Ajio', 'Lifestyle'],
    buyers: ['Retail Consumers', 'Gifting Market', 'Bridal Segment', 'Export Markets', 'Loyalty Members'],
    subsidiaries: ['Eyewear', 'Watches', 'Accessories', 'Caratlane'],
  },
  'Capital Goods': {
    suppliers: ['Bharat Forge', 'Jindal Saw', 'SKF India', 'Timken India', 'Schaeffler India', 'Elecon Engg'],
    vendors: ['Godrej & Boyce', 'Voltas', 'Kirloskar Brothers', 'Praj Industries', 'Tega Industries'],
    buyers: ['Power Projects', 'Defence', 'Metals Plants', 'Infrastructure', 'Export Contracts'],
    subsidiaries: ['Heavy Engg', 'Electrical Systems', 'Services', 'Renewables'],
  },
  Infrastructure: {
    suppliers: ['Ultratech Cement', 'JSW Steel', 'Tata Steel', 'Ambuja Cement', 'Grasim', 'Dalmia Bharat'],
    vendors: ['Ashoka Buildcon', 'NBCC', 'Ircon Intl', 'RITES', 'KEC International'],
    buyers: ['NHAI', 'Railway Ministry', 'State Govts', 'Ports', 'Metro Corporations'],
    subsidiaries: ['Roads & Highways', 'EPC', 'Real Estate', 'Infra Financing'],
  },
  Healthcare: {
    suppliers: ['Medtronic India', 'Baxter India', 'Philips India', 'GE Healthcare', 'Fresenius', 'B Braun'],
    vendors: ['Apollo Diagnostics', 'HealthCare Global', 'Fortis', 'Narayana Health', 'PharmEasy'],
    buyers: ['Insurance Companies', 'Corporate Health Programs', 'International Patients', 'Retail Patients'],
    subsidiaries: ['Diagnostics', 'Pharmacy', 'Telemedicine', 'Medical College'],
  },
  Insurance: {
    suppliers: ['TCS', 'Infosys', 'Cognizant', 'PoliciesBazaar', 'Digit', 'Acko'],
    vendors: ['IRDAI', 'ICICI Lombard', 'HDFC ERGO', 'Bajaj Allianz', 'New India Assurance'],
    buyers: ['Term Life', 'Health Policies', 'ULIP Investors', 'Corporate Group Policies', 'Annuity Holders'],
    subsidiaries: ['Pension Fund', 'Health Insurance', 'Asset Management', 'Distribution'],
  },
  Defence: {
    suppliers: ['Hindustan Aeronautics', 'Bharat Electronics', 'Bharat Dynamics', 'Mazagon Dock', 'Garden Reach', 'Cochin Shipyard'],
    vendors: ['Data Patterns', 'Astra Microwave', 'Paras Defence', 'Zen Technologies', 'Apollo Micro'],
    buyers: ['Indian Air Force', 'Indian Army', 'Indian Navy', 'DRDO', 'Export Nations', 'ISRO'],
    subsidiaries: ['Helicopter Division', 'Aircraft MRO', 'Missiles', 'Avionics'],
  },
  Travel: {
    suppliers: ['Indian Railways', 'IndiGo', 'Air India', 'IRCTC Hotels', 'ITDC', 'OYO'],
    vendors: ['Cleartrip', 'MakeMyTrip', 'Yatra', 'Expedia', 'Paytm Travel'],
    buyers: ['Rail Passengers', 'Air Travellers', 'Corporate Travel', 'Tour Operators', 'Pilgrimage Market'],
    subsidiaries: ['E-Catering', 'Hotels', 'B2B Booking', 'Tour Packages'],
  },
  Conglomerate: {
    suppliers: ['Reliance Retail', 'Adani Green', 'Nayara Energy', 'Vishal Mega Mart', 'Bharti Airtel'],
    vendors: ['L&T', 'Reliance Jio', 'Viacom18', 'Network18', 'Hathway'],
    buyers: ['Consumer Market', 'Energy Retail', 'Data Centre Clients', 'Telecom Users', 'Media Audience'],
    subsidiaries: ['Jio Platforms', 'Retail Ventures', 'New Energy', 'Media & Entertainment'],
  },
};
