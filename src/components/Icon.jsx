import React from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, Bell, BookOpen, Bot, BriefcaseBusiness,
  Building2, CalendarDays, Captions, ChartNoAxesCombined, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Circle, CircleAlert, CircleCheck, CircleDot, CircleHelp, Clapperboard, Clock3, Cloud, Code2, Cookie, Cpu, CreditCard,
  Database, Download, ExternalLink, Eye, EyeOff, FileCode2, FileText, Film, Fingerprint, Folder, Gauge, GitBranch, Globe,
  GraduationCap, Headphones, Heart, Home, Image, Info, KeyRound, Languages, Layers, LayoutDashboard, LifeBuoy,
  Lightbulb, Link2, ListChecks, Loader2, Lock, LockKeyhole, LogIn, Mail, MailCheck, Megaphone, Menu, MessageCircle,
  Mic2, Monitor, MonitorPlay, Moon, Music, Newspaper, Palette, PenLine, Play, Plug, Puzzle, Radio, Repeat2, Rocket,
  Scale, Search, Send, Server, Settings, Share2, Shield, ShieldCheck, Smartphone, Sparkle, Sparkles, Store, Sun,
  Target, Terminal, TrendingUp, Upload, User, UserPlus, Users, Video, WandSparkles, Webhook, Workflow, X, Zap,
} from 'lucide-react';

const ICONS = {
  activity: Activity, 'alert-triangle': AlertTriangle, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, 'arrow-up-right': ArrowUpRight,
  'badge-check': BadgeCheck, 'bar-chart': BarChart3, bell: Bell, book: BookOpen, bot: Bot, briefcase: BriefcaseBusiness,
  building: Building2, calendar: CalendarDays, captions: Captions, chart: ChartNoAxesCombined, check: Check,
  'check-circle': CheckCircle2, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  circle: Circle, 'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-dot': CircleDot, help: CircleHelp,
  clapperboard: Clapperboard, clock: Clock3, cloud: Cloud, code: Code2, cookie: Cookie, cpu: Cpu,
  'credit-card': CreditCard, database: Database, download: Download, 'external-link': ExternalLink, eye: Eye,
  'file-code': FileCode2, 'file-text': FileText, film: Film, fingerprint: Fingerprint, folder: Folder, gauge: Gauge, 'eye-off': EyeOff,
  'git-branch': GitBranch, globe: Globe, 'graduation-cap': GraduationCap, headphones: Headphones, heart: Heart,
  home: Home, image: Image, info: Info, key: KeyRound, languages: Languages, layers: Layers,
  'layout-dashboard': LayoutDashboard, 'life-buoy': LifeBuoy, lightbulb: Lightbulb, link: Link2,
  'list-checks': ListChecks, loader: Loader2, lock: Lock, 'lock-keyhole': LockKeyhole, login: LogIn, mail: Mail,
  'mail-check': MailCheck, megaphone: Megaphone, menu: Menu, 'message-circle': MessageCircle, mic: Mic2,
  monitor: Monitor, 'monitor-play': MonitorPlay, moon: Moon, music: Music, newspaper: Newspaper,
  palette: Palette, 'pen-line': PenLine, play: Play, plug: Plug, puzzle: Puzzle, radio: Radio, repeat: Repeat2,
  rocket: Rocket, scale: Scale, search: Search, send: Send, server: Server, settings: Settings, share: Share2, user: User,
  shield: Shield, 'shield-check': ShieldCheck, smartphone: Smartphone, sparkle: Sparkle, sparkles: Sparkles,
  store: Store, sun: Sun, target: Target, terminal: Terminal, 'trending-up': TrendingUp, upload: Upload,
  'user-plus': UserPlus, users: Users, video: Video, 'wand-sparkles': WandSparkles, webhook: Webhook,
  workflow: Workflow, x: X, zap: Zap,
};

export function Icon({ name, ...props }) {
  const Component = ICONS[name] || Circle;
  return <Component aria-hidden="true" {...props} />;
}

export default Icon;
