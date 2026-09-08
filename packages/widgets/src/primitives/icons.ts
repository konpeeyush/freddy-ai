import {
  Alert02Icon,
  CloudIcon,
  CloudAngledZapIcon,
  CloudBigRainIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudLittleRainIcon,
  CloudSnowIcon,
  HumidityIcon,
  SlowWindsIcon,
  ArrowRight02Icon,
  Bookmark02Icon,
  Calendar03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CreditCardIcon,
  Delete02Icon,
  DollarCircleIcon,
  FavouriteIcon,
  InformationCircleIcon,
  Location01Icon,
  Mail01Icon,
  MapsIcon,
  PackageIcon,
  ShoppingCart01Icon,
  Sun03Icon,
  StarIcon,
  Tag01Icon,
  Call02Icon,
  Ticket01Icon,
  TimeQuarterIcon,
  UserIcon,
  Wifi01Icon,
  CoffeeIcon,
  Car01Icon,
  Restaurant01Icon,
  SwimmingIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

/*
 * The icon set an author can name.
 *
 * Closed and hand-curated rather than passing the name straight through to
 * Hugeicons: an open set means every icon in the library is a potential
 * import, and tree-shaking cannot help when the name is only known at
 * runtime. This map is what keeps the icon cost bounded and predictable.
 *
 * Keys are the plain words an author would reach for, not library names.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ICONS: Record<string, any> = {
  // status
  check: Tick02Icon,
  "check-circle": CheckmarkCircle02Icon,
  close: Cancel01Icon,
  alert: Alert02Icon,
  info: InformationCircleIcon,
  // time
  calendar: Calendar03Icon,
  clock: Clock01Icon,
  duration: TimeQuarterIcon,
  // commerce
  cart: ShoppingCart01Icon,
  card: CreditCardIcon,
  price: DollarCircleIcon,
  tag: Tag01Icon,
  package: PackageIcon,
  ticket: Ticket01Icon,
  // place
  location: Location01Icon,
  map: MapsIcon,
  // contact
  mail: Mail01Icon,
  phone: Call02Icon,
  user: UserIcon,
  // marks
  star: StarIcon,
  heart: FavouriteIcon,
  bookmark: Bookmark02Icon,
  trash: Delete02Icon,
  arrow: ArrowRight02Icon,
  // amenities — the hotel card needs these
  wifi: Wifi01Icon,
  coffee: CoffeeIcon,
  parking: Car01Icon,
  restaurant: Restaurant01Icon,
  pool: SwimmingIcon,
  /*
   * Weather.
   *
   * One icon per kind of sky, not one icon for "weather". A card showing a
   * sun above the words "heavy drizzle" reads as broken — the picture is the
   * first thing seen and it was contradicting the sentence under it.
   */
  weather: Sun03Icon,
  clear: Sun03Icon,
  cloudy: CloudIcon,
  drizzle: CloudDrizzleIcon,
  rain: CloudLittleRainIcon,
  heavyRain: CloudBigRainIcon,
  snow: CloudSnowIcon,
  fog: CloudFogIcon,
  storm: CloudAngledZapIcon,
  wind: SlowWindsIcon,
  humidity: HumidityIcon,
}

export type IconName = keyof typeof ICONS
