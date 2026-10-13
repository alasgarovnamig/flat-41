/**
 * Thin line icons (Lucide, 1.6px stroke — DESIGN_SYSTEM §1.6). One import point so the stroke and
 * accessibility defaults stay consistent: icons are decorative (aria-hidden); the surrounding button
 * or link carries the accessible label.
 */
import {
  Apple, Archive, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck, Bath, BedDouble, Bell, Bookmark, Building2, Calendar,
  CalendarDays, Camera, ChartColumn, Check, CheckCheck, ChevronDown as LChevronDown, ChevronLeft as LChevronLeft, ChevronRight as LChevronRight, CircleAlert, Clock, CreditCard,
  Crown, Ellipsis, Eye, FileText, Flag, Globe, Heart, House, Inbox, Info, KeyRound, Landmark, Layers, LayoutGrid, List, LogOut,
  Map as MapLucide, MapPin, Maximize2, Menu, MessageCircle, Minus, Monitor, Moon, Pencil, Percent, Phone, Play, Plus, Receipt,
  RefreshCw, Ruler, Search, Send, Settings, Share2, ShieldCheck, SlidersHorizontal, Sparkles, Star, Sun, Trash2, Upload, User,
  Users, Wallet, X, Zap, type LucideIcon, type LucideProps,
} from 'lucide-react';

export type IconProps = Omit<LucideProps, 'ref'> & { size?: number; filled?: boolean };

const make = (Icon: LucideIcon) =>
  function DsIcon({ size = 20, strokeWidth = 1.6, filled, ...p }: IconProps) {
    return <Icon size={size} strokeWidth={strokeWidth} fill={filled ? 'currentColor' : 'none'} aria-hidden focusable={false} {...p} />;
  };

export const AppleIcon = make(Apple);
export const ArchiveIcon = make(Archive);
export const ArrowLeftIcon = make(ArrowLeft);
export const ArrowRightIcon = make(ArrowRight);
export const ArrowUpIcon = make(ArrowUp);
/** The universal "open" affordance (↗). */
export const ArrowUpRightIcon = make(ArrowUpRight);
export const AreaIcon = make(Ruler);
export const BathIcon = make(Bath);
export const BedIcon = make(BedDouble);
export const BellIcon = make(Bell);
export const BoltIcon = make(Zap);
export const BookmarkIcon = make(Bookmark);
export const BuildingIcon = make(Building2);
export const CalendarIcon = make(Calendar);
export const CalendarDaysIcon = make(CalendarDays);
export const CameraIcon = make(Camera);
export const CardIcon = make(CreditCard);
export const ChartIcon = make(ChartColumn);
export const ChatIcon = make(MessageCircle);
export const CheckIcon = make(Check);
export const CheckCheckIcon = make(CheckCheck);
export const ChevronDown = make(LChevronDown);
export const ChevronLeft = make(LChevronLeft);
export const ChevronRight = make(LChevronRight);
export const ClockIcon = make(Clock);
export const CloseIcon = make(X);
export const CrownIcon = make(Crown);
export const DocIcon = make(FileText);
export const EditIcon = make(Pencil);
export const ExpandIcon = make(Maximize2);
export const EyeIcon = make(Eye);
export const FilterIcon = make(SlidersHorizontal);
export const FlagIcon = make(Flag);
export const GlobeIcon = make(Globe);
export const GridIcon = make(LayoutGrid);
export const HeartIcon = make(Heart);
export const HomeIcon = make(House);
export const InboxIcon = make(Inbox);
export const InfoIcon = make(Info);
export const KeyIcon = make(KeyRound);
export const LandmarkIcon = make(Landmark);
export const LayersIcon = make(Layers);
export const ListIcon = make(List);
export const LogoutIcon = make(LogOut);
export const MapIcon = make(MapLucide);
export const MenuIcon = make(Menu);
export const MinusIcon = make(Minus);
export const MonitorIcon = make(Monitor);
export const MoonIcon = make(Moon);
export const MoreIcon = make(Ellipsis);
export const PercentIcon = make(Percent);
export const PhoneIcon = make(Phone);
export const PinIcon = make(MapPin);
export const PlayIcon = make(Play);
export const PlusIcon = make(Plus);
export const ReceiptIcon = make(Receipt);
export const RefreshIcon = make(RefreshCw);
export const SearchIcon = make(Search);
export const SendIcon = make(Send);
export const SettingsIcon = make(Settings);
export const ShareIcon = make(Share2);
export const ShieldCheckIcon = make(ShieldCheck);
export const SparklesIcon = make(Sparkles);
export const StarIcon = make(Star);
export const SunIcon = make(Sun);
export const TrashIcon = make(Trash2);
export const UploadIcon = make(Upload);
export const UserIcon = make(User);
export const UsersIcon = make(Users);
export const VerifiedIcon = make(BadgeCheck);
export const WalletIcon = make(Wallet);
export const WarningIcon = make(CircleAlert);
