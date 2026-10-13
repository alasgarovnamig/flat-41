package main

import "github.com/alasgarovnamig/evtap/api/internal/shared"

// Demo dataset — a faithful port of the former apps/api/src/db/seed.ts.

var photos = map[string][]string{
	"interior": {
		"1502672260266-1c1ef2d93688", "1560448204-e02f11c3d0e2", "1522708323590-d24dbb6b0267", "1493809842364-78817add7ffb",
		"1484154218962-a197022b5858", "1505691938895-1758d7feb511", "1600607687939-ce8a6c25118c", "1600566753190-17f0baa2a6c3",
		"1586023492125-27b2c045efd7", "1554995207-c18c203602cb", "1556909114-f6e7ad7d3136", "1505693416388-ac5ce068fe85",
	},
	"building": {"1545324418-cc1a3fa10c00", "1460317442991-0ec209397118"},
	"house": {
		"1512917774080-9991f1c4c750", "1564013799919-ab600027ffc6", "1568605114967-8130f3a36994", "1570129477492-45c003edd2be",
		"1600596542815-ffad4c1539a9", "1600585154340-be6161a56a0c", "1613490493576-7fde63acd811", "1449844908441-8829872d2607", "1518780664697-55e3ad937233",
	},
	"office":     {"1497366216548-37526070297c", "1497366811353-6870744d04b2", "1486406146926-c627a92ad1ab"},
	"land":       {"1500382017468-9049fed747ef"},
	"commercial": {"1441986300917-64674bd600d8", "1486406146926-c627a92ad1ab"},
}

// photoKinds fixes the generation order (TS Object.entries order).
var photoKinds = []string{"interior", "building", "house", "office", "land", "commercial"}

var palette = map[string][2]string{
	"interior": {"#E8DCCB", "#B08D6A"}, "building": {"#C9D6E3", "#5B7A99"}, "house": {"#D5E8D4", "#5E8B5A"},
	"office": {"#DDE3EA", "#4A5568"}, "land": {"#E9E4C9", "#8A7F3D"}, "commercial": {"#EADCF0", "#7C5A8C"},
}

type demoUser struct {
	key            int
	name, phone    string
	email          *string
	business       bool
	createdDaysAgo int
}

func sp(s string) *string { return &s }

var demoUsers = []demoUser{
	{0, "Elvin Məmmədov", "+994501112233", sp("elvin@example.az"), false, 29},
	{1, "Aynur Həsənova", "+994551234567", sp("aynur@example.az"), false, 26},
	{2, "Rəşad Quliyev", "+994702345678", nil, false, 21},
	{3, "Leyla Əliyeva", "+994773456789", sp("leyla@example.az"), false, 14},
	{4, "Nicat İsmayılov", "+994504567890", nil, false, 6},
	{5, "Kamran Babayev", "+994502220011", sp("kamran@bakuestate.az"), true, 30},
	{6, "Səbinə Rzayeva", "+994552220022", sp("sebine@xezeremlak.az"), true, 27},
	{7, "Tural Hüseynov", "+994702220033", sp("tural@agsheher.az"), true, 24},
	{8, "Orxan Nəbiyev", "+994512220044", sp("orxan@bakuestate.az"), true, 18},
}

const demoPassword = "Demo12345!"

type demoAgency struct {
	n, ownerKey                   int
	members                       []int
	name, slug, typ               string
	verified                      bool
	cityID, address, phone, email string
	website                       *string
	description                   string
}

var demoAgencies = []demoAgency{
	{1, 5, []int{8}, "Baku Estate Group", "baku-estate-group", "AGENCY", true, "baku",
		"Bakı, Nəsimi r., Füzuli küç. 49", "+994502220011", "info@bakuestate.az", sp("https://bakuestate.az"),
		"Bakıda 10 ildən artıq təcrübəyə malik daşınmaz əmlak agentliyi. Alqı-satqı, kirayə və hüquqi müşayiət xidmətləri."},
	{2, 6, nil, "Xəzər Əmlak", "xezer-emlak", "AGENCY", false, "baku",
		"Bakı, Xətai r., Babək pr. 12", "+994552220022", "office@xezeremlak.az", nil,
		"Xətai və Nizami rayonlarında mənzil və ofislərin alqı-satqısı, uzunmüddətli kirayə."},
	{3, 7, nil, "Ağ Şəhər Residence", "ag-seher-residence", "DEVELOPER", true, "baku",
		"Bakı, Xətai r., Ağ Şəhər", "+994702220033", "sales@agsheher.az", sp("https://agsheher.az"),
		"Yeni yaşayış kompleksləri: çıxarışlı mənzillər, ipoteka imkanı, bağlı həyət və yeraltı parkinq."},
}

var districtCenter = map[string][2]float64{
	"baku-nasimi": {40.392, 49.825}, "baku-yasamal": {40.383, 49.807}, "baku-narimanov": {40.405, 49.868}, "baku-nizami": {40.402, 49.935},
	"baku-khatai": {40.383, 49.948}, "baku-sabail": {40.360, 49.835}, "baku-binagadi": {40.462, 49.828}, "baku-khazar": {40.488, 50.140},
	"baku-sabunchu": {40.441, 49.940}, "baku-surakhani": {40.420, 50.010}, "baku-garadagh": {40.255, 49.600},
}

// spec mirrors the TS Spec; zero values mean "absent" (rooms/floor/total/land/guests use pointers).
type spec struct {
	deal, prop, city, district, metro string
	rooms                             *int
	area                              float64
	floor, total                      *int
	price                             int64
	owner                             int
	b, repair                         string
	am                                []string
	promo                             []string
	status                            string
	land                              *float64
	guests                            *int
	cur, title                        string
	doc, mortgage, verified           bool
}

func ip(n int) *int         { return &n }
func fp(n float64) *float64 { return &n }
func cat(a ...[]string) []string {
	out := []string{}
	for _, x := range a {
		out = append(out, x...)
	}
	return out
}

var (
	amAPT   = []string{"BALCONY", "ELEVATOR", "KOMBI", "GAS", "WATER", "ELECTRICITY", "INTERNET"}
	amFURN  = []string{"FURNITURE", "KITCHEN_FURNITURE", "WASHING_MACHINE", "REFRIGERATOR", "TV", "AIR_CONDITIONER", "WIFI"}
	amDAILY = []string{"WIFI", "AIR_CONDITIONER", "TV", "REFRIGERATOR", "KITCHEN_FURNITURE", "FURNITURE", "KIDS_ALLOWED"}
	amVILLA = []string{"GARDEN", "BBQ", "PARKING", "WIFI", "AIR_CONDITIONER", "KIDS_ALLOWED", "FURNITURE"}
)

var specs = []spec{
	// Baku — sale, apartments
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-narimanov", metro: "nariman-narimanov", rooms: ip(3), area: 128, floor: ip(9), total: ip(17), price: 285000, owner: 5, b: "NEW", repair: "EURO", am: cat(amAPT, []string{"PARKING"}), promo: []string{"premium", "vip"}, doc: true, mortgage: true, verified: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-yasamal", metro: "elmlar-akademiyasi", rooms: ip(2), area: 74, floor: ip(5), total: ip(9), price: 148000, owner: 0, b: "SECONDARY", repair: "EURO", am: amAPT, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-nasimi", metro: "28-may", rooms: ip(4), area: 165, floor: ip(12), total: ip(20), price: 520000, owner: 5, b: "NEW", repair: "DESIGNER", am: cat(amAPT, []string{"PARKING", "SECURITY", "CCTV"}), promo: []string{"vip"}, doc: true, mortgage: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-khatai", metro: "khalglar-dostlugu", rooms: ip(2), area: 68, floor: ip(3), total: ip(5), price: 92000, owner: 1, b: "SECONDARY", repair: "COSMETIC", am: []string{"BALCONY", "GAS", "WATER", "ELECTRICITY"}, promo: []string{"urgent"}, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-khatai", metro: "hazi-aslanov", rooms: ip(3), area: 112, floor: ip(14), total: ip(18), price: 176000, owner: 7, b: "NEW", repair: "NONE", am: []string{"ELEVATOR", "PARKING", "SECURITY"}, promo: []string{"premium"}, mortgage: true, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-khatai", metro: "hazi-aslanov", rooms: ip(2), area: 84, floor: ip(7), total: ip(18), price: 134000, owner: 7, b: "NEW", repair: "EURO", am: []string{"ELEVATOR", "PARKING", "SECURITY", "CCTV", "KOMBI"}, mortgage: true, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-khatai", metro: "ahmadli", rooms: ip(1), area: 52, floor: ip(4), total: ip(16), price: 82000, owner: 7, b: "NEW", repair: "NONE", am: []string{"ELEVATOR", "SECURITY"}, mortgage: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-sabail", metro: "sahil", rooms: ip(3), area: 140, floor: ip(6), total: ip(12), price: 410000, owner: 6, b: "NEW", repair: "DESIGNER", am: cat(amAPT, []string{"SEA_VIEW", "PARKING"}), promo: []string{"vip", "hl"}, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-binagadi", metro: "azadlig-prospekti", rooms: ip(3), area: 95, floor: ip(2), total: ip(9), price: 138000, owner: 2, b: "SECONDARY", repair: "EURO", am: amAPT, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-nizami", metro: "qara-qarayev", rooms: ip(2), area: 58, floor: ip(5), total: ip(5), price: 87000, owner: 3, b: "SECONDARY", repair: "COSMETIC", am: []string{"BALCONY", "GAS", "WATER"}},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-nasimi", metro: "nasimi", rooms: ip(3), area: 105, floor: ip(10), total: ip(16), price: 199000, owner: 8, b: "NEW", repair: "EURO", am: cat(amAPT, []string{"PARKING"}), doc: true, mortgage: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-yasamal", metro: "inshaatchilar", rooms: ip(4), area: 150, floor: ip(15), total: ip(22), price: 330000, owner: 5, b: "NEW", repair: "EURO", am: cat(amAPT, []string{"PARKING", "SECURITY"}), doc: true, status: "PENDING"},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-narimanov", metro: "ganjlik", rooms: ip(2), area: 80, floor: ip(8), total: ip(14), price: 165000, owner: 6, b: "NEW", repair: "EURO", am: amAPT, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-sabail", metro: "icherisheher", rooms: ip(5), area: 210, floor: ip(3), total: ip(4), price: 600000, owner: 0, b: "SECONDARY", repair: "DESIGNER", am: cat(amAPT, []string{"CENTRAL_HEATING", "SEA_VIEW"}), doc: true, status: "PENDING"},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-nizami", metro: "neftchilar", rooms: ip(1), area: 45, floor: ip(2), total: ip(9), price: 72000, owner: 4, b: "SECONDARY", repair: "EURO", am: []string{"GAS", "WATER", "ELECTRICITY", "INTERNET"}, status: "EXPIRED"},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-yasamal", metro: "20-yanvar", rooms: ip(3), area: 88, floor: ip(1), total: ip(9), price: 128000, owner: 1, b: "SECONDARY", repair: "COSMETIC", am: []string{"GAS", "WATER"}, status: "SOLD"},
	// Baku — sale, houses / land / office / commercial
	{deal: "SALE", prop: "HOUSE", city: "baku", district: "baku-khazar", rooms: ip(5), area: 320, land: fp(8), price: 450000, owner: 5, repair: "EURO", am: cat(amVILLA, []string{"POOL", "SAUNA"}), promo: []string{"premium"}, title: "Mərdəkanda hovuzlu villa, 8 sot", doc: true},
	{deal: "SALE", prop: "HOUSE", city: "baku", district: "baku-sabunchu", rooms: ip(4), area: 180, land: fp(4), price: 155000, owner: 2, repair: "COSMETIC", am: []string{"GARDEN", "GAS", "WATER", "ELECTRICITY"}, title: "Bakıxanovda 4 otaqlı həyət evi"},
	{deal: "SALE", prop: "HOUSE", city: "baku", district: "baku-khazar", rooms: ip(6), area: 400, land: fp(12), price: 590000, owner: 6, repair: "DESIGNER", am: cat(amVILLA, []string{"POOL", "SEA_VIEW", "SECURITY"}), promo: []string{"vip"}, title: "Şüvəlanda dənizə yaxın 6 otaqlı villa", doc: true},
	{deal: "SALE", prop: "LAND", city: "baku", district: "baku-khazar", area: 1000, land: fp(10), price: 120000, owner: 3, am: []string{"ELECTRICITY", "WATER", "GAS"}, title: "Buzovnada 10 sot torpaq sahəsi, kommunikasiyalar var", doc: true},
	{deal: "SALE", prop: "LAND", city: "absheron", area: 600, land: fp(6), price: 36000, owner: 4, am: []string{"ELECTRICITY"}, title: "Masazırda 6 sot torpaq, yaşayış üçün"},
	{deal: "SALE", prop: "OFFICE", city: "baku", district: "baku-nasimi", metro: "28-may", area: 210, floor: ip(6), total: ip(14), price: 480000, owner: 5, repair: "EURO", am: []string{"ELEVATOR", "AIR_CONDITIONER", "INTERNET", "SECURITY", "PARKING"}, title: "28 May metrosu yanında 210 m² ofis", doc: true},
	{deal: "SALE", prop: "COMMERCIAL", city: "baku", district: "baku-yasamal", metro: "elmlar-akademiyasi", area: 95, floor: ip(1), total: ip(12), price: 260000, owner: 6, repair: "EURO", am: []string{"ELECTRICITY", "WATER", "AIR_CONDITIONER"}, title: "Əsas yol üstündə 95 m² obyekt (mağaza üçün)", doc: true},
	// Baku — long rent
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-nasimi", metro: "nizami", rooms: ip(2), area: 70, floor: ip(4), total: ip(9), price: 900, owner: 1, b: "SECONDARY", repair: "EURO", am: cat(amAPT, amFURN)},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-narimanov", metro: "nariman-narimanov", rooms: ip(3), area: 120, floor: ip(11), total: ip(17), price: 1500, owner: 5, b: "NEW", repair: "EURO", am: cat(amAPT, amFURN, []string{"PARKING"}), promo: []string{"vip"}},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-sabail", metro: "sahil", rooms: ip(3), area: 135, floor: ip(8), total: ip(15), price: 3000, owner: 6, b: "NEW", repair: "DESIGNER", am: cat(amAPT, amFURN, []string{"SEA_VIEW", "DISHWASHER"}), promo: []string{"hl"}},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-khatai", metro: "shah-ismayil-khatai", rooms: ip(1), area: 45, floor: ip(3), total: ip(9), price: 450, owner: 2, b: "SECONDARY", repair: "COSMETIC", am: []string{"FURNITURE", "REFRIGERATOR", "GAS", "WATER"}},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-yasamal", metro: "memar-ajami", rooms: ip(2), area: 65, floor: ip(6), total: ip(12), price: 700, owner: 3, b: "NEW", repair: "EURO", am: cat(amAPT, amFURN), promo: []string{"urgent"}},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-binagadi", metro: "8-noyabr", rooms: ip(2), area: 60, floor: ip(2), total: ip(5), price: 550, owner: 4, b: "SECONDARY", repair: "COSMETIC", am: []string{"FURNITURE", "KITCHEN_FURNITURE", "GAS"}},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "baku", district: "baku-nizami", metro: "koroghlu", rooms: ip(3), area: 90, floor: ip(7), total: ip(16), price: 850, owner: 8, b: "NEW", repair: "EURO", am: cat(amAPT, amFURN), status: "PENDING"},
	{deal: "RENT_LONG", prop: "ROOM", city: "baku", district: "baku-yasamal", metro: "elmlar-akademiyasi", rooms: ip(1), area: 18, floor: ip(3), total: ip(9), price: 250, owner: 0, b: "SECONDARY", repair: "COSMETIC", am: []string{"FURNITURE", "WIFI"}, title: "Tələbə qıza otaq kirayə verilir, Elmlər Akademiyası m."},
	{deal: "RENT_LONG", prop: "OFFICE", city: "baku", district: "baku-nasimi", metro: "jafar-jabbarli", area: 120, floor: ip(5), total: ip(10), price: 2200, owner: 5, repair: "EURO", am: []string{"ELEVATOR", "AIR_CONDITIONER", "INTERNET", "SECURITY"}, title: "Cəfər Cabbarlı metrosu yanında 120 m² ofis kirayəsi"},
	{deal: "RENT_LONG", prop: "COMMERCIAL", city: "baku", district: "baku-narimanov", metro: "ganjlik", area: 80, floor: ip(1), total: ip(9), price: 1800, owner: 6, repair: "EURO", am: []string{"ELECTRICITY", "WATER"}, title: "Gənclikdə 80 m² obyekt icarəyə verilir (kafe, mağaza)"},
	{deal: "RENT_LONG", prop: "HOUSE", city: "baku", district: "baku-khazar", rooms: ip(4), area: 220, land: fp(6), price: 2500, owner: 2, repair: "EURO", am: amVILLA, title: "Novxanıda 4 otaqlı villa uzunmüddətli kirayə", status: "PENDING"},
	// Baku — daily rent
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "baku", district: "baku-sabail", metro: "icherisheher", rooms: ip(2), area: 65, floor: ip(3), total: ip(5), price: 120, owner: 3, repair: "DESIGNER", am: cat(amDAILY, []string{"SEA_VIEW"}), guests: ip(4), promo: []string{"premium"}},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "baku", district: "baku-nasimi", metro: "28-may", rooms: ip(1), area: 42, floor: ip(7), total: ip(12), price: 60, owner: 1, repair: "EURO", am: amDAILY, guests: ip(2)},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "baku", district: "baku-sabail", metro: "sahil", rooms: ip(3), area: 110, floor: ip(10), total: ip(16), price: 180, owner: 6, repair: "DESIGNER", am: cat(amDAILY, []string{"SEA_VIEW", "WASHING_MACHINE"}), guests: ip(6), promo: []string{"vip"}},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "baku", district: "baku-khazar", rooms: ip(4), area: 250, land: fp(10), price: 300, owner: 0, repair: "EURO", am: cat(amVILLA, []string{"POOL", "SAUNA"}), guests: ip(10), title: "Mərdəkanda hovuzlu villa günlük kirayə"},
	// Sumgait, Ganja, Absheron
	{deal: "SALE", prop: "APARTMENT", city: "sumgait", district: "sumgait-center", rooms: ip(3), area: 85, floor: ip(4), total: ip(9), price: 78000, owner: 2, b: "SECONDARY", repair: "EURO", am: amAPT, doc: true},
	{deal: "SALE", prop: "APARTMENT", city: "sumgait", district: "sumgait-center", rooms: ip(2), area: 72, floor: ip(9), total: ip(16), price: 89000, owner: 7, b: "NEW", repair: "NONE", am: []string{"ELEVATOR", "SEA_VIEW"}, mortgage: true, title: "Sumqayıt bulvarı yanında yeni tikili, 2 otaq"},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "sumgait", district: "sumgait-corat", rooms: ip(2), area: 60, floor: ip(2), total: ip(5), price: 400, owner: 4, b: "SECONDARY", repair: "COSMETIC", am: []string{"FURNITURE", "GAS"}},
	{deal: "SALE", prop: "APARTMENT", city: "ganja", district: "ganja-kapaz", rooms: ip(3), area: 100, floor: ip(5), total: ip(9), price: 85000, owner: 3, b: "SECONDARY", repair: "EURO", am: amAPT, doc: true},
	{deal: "SALE", prop: "HOUSE", city: "ganja", district: "ganja-nizami", rooms: ip(5), area: 240, land: fp(6), price: 165000, owner: 1, repair: "EURO", am: []string{"GARDEN", "GAS", "WATER", "PARKING"}, title: "Gəncədə 5 otaqlı həyət evi, 6 sot", doc: true},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "ganja", district: "ganja-kapaz", rooms: ip(2), area: 70, floor: ip(3), total: ip(9), price: 400, owner: 0, b: "SECONDARY", repair: "EURO", am: amFURN},
	{deal: "SALE", prop: "HOUSE", city: "khirdalan", rooms: ip(3), area: 130, land: fp(3), price: 98000, owner: 4, repair: "COSMETIC", am: []string{"GARDEN", "GAS", "WATER"}, title: "Xırdalanda 3 otaqlı həyət evi", status: "REJECTED"},
	// Resorts — daily rent houses
	{deal: "RENT_DAILY", prop: "HOUSE", city: "gabala", rooms: ip(3), area: 140, land: fp(5), price: 150, owner: 2, repair: "EURO", am: cat(amVILLA, []string{"SAUNA"}), guests: ip(8), title: "Qəbələdə meşə kənarında kottec, günlük", promo: []string{"vip"}},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "gabala", rooms: ip(2), area: 80, land: fp(3), price: 90, owner: 3, repair: "EURO", am: amVILLA, guests: ip(5), title: "Qəbələ, Vəndam yolunda taxta ev günlük kirayə"},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "guba", rooms: ip(4), area: 180, land: fp(8), price: 200, owner: 0, repair: "EURO", am: cat(amVILLA, []string{"POOL"}), guests: ip(10), title: "Qubada hovuzlu bağ evi, almalıqda", promo: []string{"hl"}},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "guba", rooms: ip(2), area: 70, land: fp(2), price: 70, owner: 4, repair: "COSMETIC", am: []string{"GARDEN", "BBQ", "WIFI"}, guests: ip(4), title: "Quba, Qəçrəş meşəsində kiçik ev"},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "nabran", rooms: ip(3), area: 120, land: fp(6), price: 160, owner: 1, repair: "EURO", am: cat(amVILLA, []string{"SEA_VIEW"}), guests: ip(8), title: "Nabranda dənizə 300 m məsafədə bağ evi", promo: []string{"premium"}},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "nabran", rooms: ip(2), area: 75, land: fp(4), price: 80, owner: 2, repair: "COSMETIC", am: []string{"GARDEN", "BBQ", "KIDS_ALLOWED", "WIFI"}, guests: ip(5), title: "Nabran, meşə içində iki otaqlı kottec"},
	{deal: "RENT_DAILY", prop: "HOUSE", city: "gusar", rooms: ip(3), area: 130, land: fp(5), price: 140, owner: 3, repair: "EURO", am: cat(amVILLA, []string{"SAUNA"}), guests: ip(7), title: "Qusarda Şahdağ yolunda dağ evi", status: "PENDING"},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "shaki", rooms: ip(2), area: 60, floor: ip(2), total: ip(3), price: 50, owner: 4, repair: "EURO", am: amDAILY, guests: ip(4), title: "Şəkidə mərkəzdə günlük mənzil, Xan sarayına yaxın"},
	// Georgia
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "batumi", district: "batumi-new", rooms: ip(1), area: 45, floor: ip(22), total: ip(40), price: 75, owner: 0, repair: "DESIGNER", am: cat(amDAILY, []string{"SEA_VIEW", "POOL"}), guests: ip(3), cur: "USD", title: "Batumi, Yeni Bulvar — dəniz mənzərəli studio", promo: []string{"vip"}},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "batumi", district: "batumi-old", rooms: ip(2), area: 70, floor: ip(5), total: ip(9), price: 110, owner: 3, repair: "EURO", am: amDAILY, guests: ip(4), cur: "USD", title: "Köhnə Batumidə iki otaqlı günlük mənzil"},
	{deal: "SALE", prop: "APARTMENT", city: "batumi", district: "batumi-new", rooms: ip(2), area: 68, floor: ip(18), total: ip(35), price: 85000, owner: 6, b: "NEW", repair: "EURO", am: []string{"ELEVATOR", "POOL", "SEA_VIEW", "SECURITY"}, cur: "USD", title: "Batumidə dəniz kənarında yeni tikili, 2 otaq"},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "tbilisi", district: "tbilisi-mtatsminda", rooms: ip(2), area: 65, floor: ip(3), total: ip(5), price: 180, owner: 1, repair: "DESIGNER", am: amDAILY, guests: ip(4), cur: "GEL", title: "Tbilisi, Köhnə şəhərdə balkonlu mənzil günlük"},
	{deal: "SALE", prop: "APARTMENT", city: "tbilisi", district: "tbilisi-vake", rooms: ip(3), area: 110, floor: ip(7), total: ip(12), price: 210000, owner: 5, b: "NEW", repair: "EURO", am: cat(amAPT, []string{"PARKING"}), cur: "USD", title: "Tbilisi, Vake — 3 otaqlı yeni tikili"},
	{deal: "RENT_LONG", prop: "APARTMENT", city: "tbilisi", district: "tbilisi-saburtalo", rooms: ip(2), area: 60, floor: ip(9), total: ip(16), price: 1500, owner: 2, b: "NEW", repair: "EURO", am: cat(amAPT, amFURN), cur: "GEL", title: "Saburtalo, metroya yaxın 2 otaqlı mənzil kirayə"},
	// more Baku
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-surakhani", rooms: ip(2), area: 62, floor: ip(3), total: ip(5), price: 64000, owner: 4, b: "SECONDARY", repair: "COSMETIC", am: []string{"GAS", "WATER", "ELECTRICITY"}, title: "Hövsanda 2 otaqlı mənzil, təcili satılır", promo: []string{"urgent"}},
	{deal: "SALE", prop: "GARAGE", city: "baku", district: "baku-yasamal", metro: "inshaatchilar", area: 22, price: 18000, owner: 0, am: []string{"ELECTRICITY"}, title: "İnşaatçılar m. yanında qaraj satılır", status: "PENDING"},
	{deal: "SALE", prop: "APARTMENT", city: "baku", district: "baku-narimanov", metro: "bakmil", rooms: ip(3), area: 98, floor: ip(6), total: ip(10), price: 175000, owner: 8, b: "NEW", repair: "EURO", am: amAPT, doc: true, mortgage: true},
	{deal: "RENT_DAILY", prop: "APARTMENT", city: "baku", district: "baku-nasimi", metro: "sahil", rooms: ip(1), area: 38, floor: ip(4), total: ip(9), price: 45, owner: 2, repair: "EURO", am: amDAILY, guests: ip(2), status: "PENDING"},
}

var repairText = map[string]string{"NONE": "Təmirsizdir (ağ karkas)", "COSMETIC": "Kosmetik təmirlidir", "EURO": "Avro təmirlidir", "DESIGNER": "Dizayner təmirlidir"}

type cmsPage struct {
	slug        string
	title, body shared.Localized
}

var pages = []cmsPage{
	{"about", shared.Localized{Az: "Haqqımızda", Ru: "О нас", En: "About us"}, shared.Localized{
		Az: "## EvTap haqqında\n\nEvTap — Azərbaycanda və Gürcüstanda daşınmaz əmlakın alqı-satqısı, uzunmüddətli və günlük kirayəsi üçün müasir platformadır. Biz yoxlanılmış elanlar, xəritədə axtarış, onlayn rezervasiya və təhlükəsiz ödəniş təklif edirik.",
		Ru: "## О EvTap\n\nEvTap — современная платформа для покупки, продажи, долгосрочной и посуточной аренды недвижимости в Азербайджане и Грузии. Проверенные объявления, поиск на карте, онлайн-бронирование и безопасная оплата.",
		En: "## About EvTap\n\nEvTap is a modern marketplace for buying, selling, long-term and daily rentals of real estate in Azerbaijan and Georgia. Verified listings, map search, online booking and secure payments."}},
	{"terms", shared.Localized{Az: "İstifadə şərtləri", Ru: "Условия использования", En: "Terms of use"}, shared.Localized{
		Az: "## İstifadə şərtləri\n\n1. Elan yerləşdirən şəxs məlumatların düzgünlüyünə görə məsuliyyət daşıyır.\n2. Saxta, təkrar və ya yanlış qiymətli elanlar bloklanır.\n3. Ödənişli xidmətlər göstərildikdən sonra geri qaytarılmır, istisnalar qaydalarda göstərilib.\n4. Günlük kirayə rezervasiyalarında ləğv qaydaları tətbiq olunur.",
		Ru: "## Условия использования\n\n1. Автор объявления несёт ответственность за достоверность данных.\n2. Фейковые, дублирующиеся объявления и объявления с неверной ценой блокируются.\n3. Платные услуги после оказания не возвращаются, исключения указаны в правилах.\n4. Для посуточных бронирований действуют правила отмены.",
		En: "## Terms of use\n\n1. The author of a listing is responsible for its accuracy.\n2. Fake, duplicate or mispriced listings are blocked.\n3. Paid services are non-refundable once delivered, except as stated in the rules.\n4. Cancellation rules apply to daily-rent bookings."}},
	{"privacy", shared.Localized{Az: "Məxfilik siyasəti", Ru: "Политика конфиденциальности", En: "Privacy policy"}, shared.Localized{
		Az: "## Məxfilik siyasəti\n\nTelefon nömrəniz yalnız giriş və elan əlaqəsi üçün istifadə olunur. Hesabınızı istənilən vaxt tətbiqdən silə bilərsiniz — bu zaman şəxsi məlumatlarınız anonimləşdirilir.",
		Ru: "## Политика конфиденциальности\n\nВаш номер телефона используется только для входа и связи по объявлениям. Вы можете удалить аккаунт в любой момент — персональные данные будут обезличены.",
		En: "## Privacy policy\n\nYour phone number is used only for sign-in and listing contact. You can delete your account at any time — your personal data will be anonymised."}},
	{"help", shared.Localized{Az: "Kömək", Ru: "Помощь", En: "Help"}, shared.Localized{
		Az: "## Tez-tez verilən suallar\n\n**Elanı necə yerləşdirim?** \"Elan yerləşdir\" düyməsini basın, şəkilləri yükləyin və formu doldurun.\n\n**Elanım nə vaxt dərc olunacaq?** Moderasiya adətən 1 saata qədər çəkir.\n\n**Günlük kirayəni necə bron edim?** Tarixləri seçin və kartla və ya balansla ödəyin.",
		Ru: "## Частые вопросы\n\n**Как подать объявление?** Нажмите «Подать объявление», загрузите фото и заполните форму.\n\n**Когда объявление опубликуют?** Модерация обычно занимает до 1 часа.\n\n**Как забронировать посуточно?** Выберите даты и оплатите картой или с баланса.",
		En: "## FAQ\n\n**How do I post a listing?** Tap \"Post a listing\", upload photos and fill in the form.\n\n**When will it be published?** Moderation usually takes up to 1 hour.\n\n**How do I book a daily rental?** Pick dates and pay by card or wallet."}},
	{"pricing-info", shared.Localized{Az: "Qiymətlər", Ru: "Цены", En: "Pricing"}, shared.Localized{
		Az: "## Xidmətlərin qiymətləri\n\n- 30 gündə 2 elan pulsuzdur, sonrakı hər elan — 3 ₼\n- Günlük kirayə elanları pulsuzdur\n- Yuxarı qaldır — 1 ₼, VIP — 1.5 ₼-dan, Premium — 3 ₼-dan\n- Agentliklər üçün abunəliklər: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / ay",
		Ru: "## Цены на услуги\n\n- 2 объявления за 30 дней бесплатно, далее — 3 ₼ за объявление\n- Посуточные объявления бесплатны\n- Поднятие — 1 ₼, VIP — от 1.5 ₼, Премиум — от 3 ₼\n- Подписки для агентств: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / мес",
		En: "## Pricing\n\n- 2 free listings per 30 days, then 3 ₼ per listing\n- Daily-rent listings are free\n- Bump — 1 ₼, VIP — from 1.5 ₼, Premium — from 3 ₼\n- Agency plans: Start 49 ₼, Pro 129 ₼, Enterprise 299 ₼ / month"}},
}

type banner struct {
	n                         int
	placement, title, photoID string
	linkURL                   string
	sortOrder                 int
}

var banners = []banner{
	{1, "HOME_TOP", "Ağ Şəhər Residence — 8% ipoteka ilə yeni mənzillər", "1545324418-cc1a3fa10c00", "https://evtap.az/agencies/ag-seher-residence", 0},
	{2, "SEARCH_SIDEBAR", "Kapital Bank ipotekası — illik 8%-dən", "1560448204-e02f11c3d0e2", "https://evtap.az/mortgage", 0},
	{3, "MOBILE_HOME", "Yay mövsümü: Nabran və Qəbələdə günlük evlər", "1449844908441-8829872d2607", "https://evtap.az/search?dealType=RENT_DAILY", 0},
}

type report struct {
	n, l    int
	by      *int
	reason  string
	comment *string
}

var reports = []report{
	{1, 3, ip(0), "WRONG_PRICE", sp("Zəng etdim, qiymət 110 000 dedilər.")},
	{2, 23, ip(3), "AGENT_AS_OWNER", sp("Mülkiyyətçi kimi göstərilib, amma vasitəçidir.")},
	{3, 27, ip(4), "ALREADY_SOLD", nil},
	{4, 8, nil, "FAKE", sp("Bu ünvanda belə bina yoxdur.")},
}

type lead struct {
	n                 int
	name, phone       string
	l                 *int
	price, down, term int
	bank              *string
	status            string
}

var leads = []lead{
	{1, "Fərid Abbasov", "+994503334455", ip(0), 285000, 60000, 20, sp("KAPITAL"), "NEW"},
	{2, "Günel Səfərova", "+994554445566", ip(4), 176000, 35000, 15, sp("ABB"), "SENT_TO_BANK"},
	{3, "Ramin Kərimov", "+994705556677", nil, 120000, 25000, 25, nil, "NEW"},
	{4, "Nərmin Qasımova", "+994776667788", ip(10), 199000, 50000, 20, sp("PASHA"), "CLOSED"},
}

// favs: [userKey, listingIndex]
var favs = [][2]int{{0, 0}, {0, 2}, {0, 34}, {1, 0}, {1, 45}, {3, 7}, {3, 24}, {4, 0}, {4, 16}, {2, 52}}
