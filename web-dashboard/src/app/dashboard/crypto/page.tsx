"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    ArrowDownRight,
    ArrowUpRight,
    BarChart3,
    BrainCircuit,
    Check,
    Coffee,
    Info,
    LineChart,
    Loader2,
    Newspaper,
    Plus,
    RefreshCcw,
    Search,
    Sparkles,
    Trash2,
    User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGolem } from "@/components/GolemContext";
import { useI18n } from "@/components/I18nProvider";
import { useToast } from "@/components/ui/toast-provider";
import { apiUrl } from "@/lib/api";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
    CRYPTO_FEATURE_ENABLED_STORAGE_KEY,
    DASHBOARD_FEATURE_FLAGS_UPDATED_EVENT,
    SIDEBAR_NAV_HIDDEN_UPDATED_EVENT,
    isDashboardRouteHidden,
    readFeatureEnabled
} from "@/lib/dashboard-feature-flags";

type Market = "crypto";
type MarketFilter = Market | "all";
type RangeKey = "5m" | "15m" | "1h" | "1d" | "1M";

type CryptoQuote = {
    symbol: string;
    yahooSymbol: string;
    name: string;
    market: Market;
    currency: string;
    exchangeName?: string;
    exchangeTimezoneName?: string;
    price: number;
    previousClose: number;
    open: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    change: number;
    changePercent: number;
    volume: number;
    turnover: number;
    marketCap: number | null;
    sector: string;
    dataSource: string;
    lastUpdatedAt: string;
    dataQuality?: "live" | "stale-cache";
};

type HistoryPoint = {
    time: string;
    price: number;
    close: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number;
};

type CryptoIndicators = {
    sma20: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    stochasticK: number | null;
    stochasticD: number | null;
    mfi14: number | null;
    atr14: number | null;
    bollingerMiddle: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
    bollingerWidthPercent: number | null;
    donchianUpper20: number | null;
    donchianLower20: number | null;
    donchianMiddle20: number | null;
    volatility: number | null;
    maxDrawdown: number | null;
    avgVolume20: number | null;
    volumeRatio: number | null;
    volumeZScore20: number | null;
    obv: number | null;
    distanceToSma20Percent: number | null;
    distanceTo52wHighPercent: number | null;
    distanceTo52wLowPercent: number | null;
};

type SearchResult = {
    symbol: string;
    yahooSymbol: string;
    name: string;
    market: Market;
    exchange: string;
    type: string;
    sector?: string;
    dataSource: string;
};

type QuotesResponse = {
    quotes?: CryptoQuote[];
    errors?: Array<{ symbol: string; error: string }>;
    dataSource?: string;
    generatedAt?: string;
};

type HistoryResponse = {
    history?: {
        symbol: string;
        yahooSymbol: string;
        points: HistoryPoint[];
        indicators: CryptoIndicators;
        dataQuality?: "live" | "stale-cache";
    };
    dataSource?: string;
    generatedAt?: string;
};

type SearchResponse = {
    results?: SearchResult[];
};

type CryptoNewsItem = {
    title: string;
    url: string;
    snippet: string;
    source: string;
    publishedAt?: string;
};

type CryptoNews = {
    symbol: string;
    yahooSymbol: string;
    name: string;
    query: string;
    languagePriority: string;
    dateWindow: {
        since: string;
        until: string;
        days: number;
    };
    source: string;
    fetchedAt: string;
    results: CryptoNewsItem[];
};

type NewsResponse = {
    news?: CryptoNews;
};

type SnapshotRefreshResponse = {
    snapshot?: CryptoDashboardSnapshot;
    quota?: {
        limit: number;
        used: number;
        remaining: number;
    };
};

type CryptoEntitlements = {
    tier: "visitor" | "general" | "sponsor";
    label: string;
    watchlistLimit: number;
    refreshIntervalSecMin: number;
    aiInsightDailyQuota: number;
    canUseAdvancedIndicators: boolean;
    canExportReport: boolean;
    historyRangeLimit: string;
};

type CryptoMembershipStatusResponse = {
    membership?: {
        uid: string;
        email: string;
        tier: "visitor" | "general" | "sponsor";
        authenticated: boolean;
        entitlements: CryptoEntitlements;
        quota: {
            limit: number;
            used: number;
            remaining: number;
        };
    };
};

type AccessGateState = {
    title: string;
    body: string;
    step: 1 | 2;
    note?: string;
};

type CryptoDashboardSnapshot = {
    source: string;
    dataStatus: string;
    marketFilter: MarketFilter;
    selectedRange: RangeKey;
    selected: CryptoQuote | null;
    indicators: CryptoIndicators | null;
    news: CryptoNews | null;
    watchlist: CryptoQuote[];
    breadth: {
        advancers: number;
        decliners: number;
        averageMove: number;
        totalTurnover: number;
        count: number;
    };
    quoteErrors: Array<{ symbol: string; error: string }>;
    generatedAt: string;
    savedAt?: string;
    refresh?: {
        trigger: string;
        status: string;
        previousSavedAt: string | null;
    };
};

const WATCHLIST_STORAGE_KEY = "golem-crypto-watchlist-v1";
const QUOTE_PREFERENCE_STORAGE_KEY = "golem-crypto-quote-preference-v1";
const SUPPORT_PROMPT_STORAGE_KEY = "golem-crypto-support-prompt-snoozed-at-v1";
const DEFAULT_WATCHLIST = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "DOGE-USDT"];
const DEFAULT_AUTO_REFRESH_MS = 60 * 1000;
const NEWS_REFRESH_MS = 60 * 60 * 1000;
const SUPPORT_PROMPT_INTERVAL_MS = 150 * 60 * 1000;
const SUPPORT_PROMPT_INITIAL_DELAY_MS = 45 * 1000;
const SUPPORT_URL = "https://buymeacoffee.com/arvincreator/e/534156";
const CRYPTO_DASHBOARD_HREF = "/dashboard/crypto";
const SUPPORT_COPY_VARIANTS = [
    {
        zhTitle: "還在努力盯盤嗎？",
        zhBody: "記得喝杯咖啡提神，順便也給作者帶上一杯喔！",
        zhAction: "請作者喝咖啡",
        enTitle: "Still watching the tape?",
        enBody: "Grab a coffee to stay sharp, and maybe bring one for the author too.",
        enAction: "Buy a coffee",
    },
    {
        zhTitle: "作者的佛心打動不了你的慈悲嗎？",
        zhBody: "這個看板都努力幫你盯行情了，添點油香給作者，讓功能繼續長大。",
        zhAction: "添點油香",
        enTitle: "Did the author's generosity miss your soft spot?",
        enBody: "This board is keeping watch with you. A tiny tip keeps the features growing.",
        enAction: "Send a tip",
    },
    {
        zhTitle: "這裡有一位需要咖啡的開發者",
        zhBody: "作者不眠不休打磨這個程式，5 美金剛好能補一杯星巴克能量。",
        zhAction: "補一杯星巴克",
        enTitle: "Developer fuel is running low",
        enBody: "A few dollars can turn into one very useful cup of coffee and a few more fixes.",
        enAction: "Fuel development",
    },
    {
        zhTitle: "K 線會震盪，作者也會餓",
        zhBody: "如果這頁幫你少看錯一根線，請用一杯咖啡讓作者回血。",
        zhAction: "幫作者回血",
        enTitle: "Candles move. Developers fade.",
        enBody: "If this page saved you from one bad read, coffee is a noble exchange.",
        enAction: "Restore HP",
    },
    {
        zhTitle: "今天的行情很刺激嗎？",
        zhBody: "你的心跳交給市場，作者的咖啡因交給你。小額贊助一下，彼此都穩。",
        zhAction: "穩住作者",
        enTitle: "Markets feeling spicy today?",
        enBody: "Let the market handle your pulse. Let your coffee support handle the author.",
        enAction: "Keep it steady",
    },
    {
        zhTitle: "這個按鈕不是廣告，是補給站",
        zhBody: "一點點支持，就能讓作者繼續修 bug、加功能、跟 Yahoo API 交涉人生。",
        zhAction: "送補給",
        enTitle: "This button is a supply station",
        enBody: "A little support helps with bugs, features, and the long conversation with market APIs.",
        enAction: "Send supplies",
    },
    {
        zhTitle: "你負責看幣，我負責提醒",
        zhBody: "作者負責把工具變好。這個分工很美，只差一杯咖啡收尾。",
        zhAction: "完成分工",
        enTitle: "You watch. I remind.",
        enBody: "The author keeps improving the tool. A coffee would complete the workflow.",
        enAction: "Complete the loop",
    },
    {
        zhTitle: "如果這頁有讓你嘴角上揚",
        zhBody: "那就讓作者的咖啡杯也上揚一下。小額贊助，快樂互相流動。",
        zhAction: "讓咖啡杯上揚",
        enTitle: "If this page made you smile",
        enBody: "Let the author's coffee cup rise too. Tiny support, good vibes.",
        enAction: "Raise the cup",
    },
];
const CRYPTO_SYMBOL_RE = /^[A-Z0-9]{2,12}[-/](USD|USDT|USDC|BUSD|DAI|BTC|ETH)$/;
const CRYPTO_QUOTE_SUFFIXES = ["USDT", "USDC", "BUSD", "DAI", "USD", "BTC", "ETH"] as const;
const STABLE_QUOTES = new Set(["USD", "USDT", "USDC", "BUSD", "DAI"]);
type QuotePreference = "USDT" | "USDC";
const RANGE_MAP: Record<RangeKey, { range: string; interval: string }> = {
    "5m": { range: "1d", interval: "5m" },
    "15m": { range: "5d", interval: "15m" },
    "1h": { range: "1mo", interval: "60m" },
    "1d": { range: "1y", interval: "1d" },
    "1M": { range: "1mo", interval: "1d" },
};

function normalizeSymbol(input: string, preferredQuote: QuotePreference = "USDT") {
    const value = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!value) return "";
    if (CRYPTO_SYMBOL_RE.test(value)) {
        const direct = value.replace("/", "-");
        if (direct.endsWith("-USD")) return direct.replace(/-USD$/, `-${preferredQuote}`);
        const [base, quote = ""] = direct.split("-");
        if (STABLE_QUOTES.has(quote) && quote !== preferredQuote) return `${base}-${preferredQuote}`;
        return direct;
    }
    const pair = value.replace("/", "-");
    if (/^[A-Z0-9]{2,12}-[A-Z0-9]{2,8}$/.test(pair)) {
        if (pair.endsWith("-USD")) return pair.replace(/-USD$/, `-${preferredQuote}`);
        const [base, quote = ""] = pair.split("-");
        if (STABLE_QUOTES.has(quote) && quote !== preferredQuote) return `${base}-${preferredQuote}`;
        return pair;
    }
    for (const quote of CRYPTO_QUOTE_SUFFIXES) {
        if (value.endsWith(quote) && value.length > quote.length + 1) {
            const base = value.slice(0, -quote.length);
            if (/^[A-Z0-9]{2,12}$/.test(base)) return `${base}-${quote}`;
        }
    }
    if (/^[A-Z0-9]{2,12}$/.test(value)) return `${value}-${preferredQuote}`;
    return value.replace("/", "-");
}

function readStoredQuotePreference(): QuotePreference {
    if (typeof window === "undefined") return "USDT";
    const raw = String(localStorage.getItem(QUOTE_PREFERENCE_STORAGE_KEY) || "").toUpperCase();
    return raw === "USDC" ? "USDC" : "USDT";
}

function displaySymbol(symbol: string) {
    return String(symbol || "").replace(/-(USD|USDT|USDC|BUSD|DAI|BTC|ETH)$/i, "");
}

function pickSupportCopyIndex(currentIndex = -1) {
    if (SUPPORT_COPY_VARIANTS.length <= 1) return 0;
    const nextIndex = Math.floor(Math.random() * SUPPORT_COPY_VARIANTS.length);
    return nextIndex === currentIndex ? (nextIndex + 1) % SUPPORT_COPY_VARIANTS.length : nextIndex;
}

function readStoredWatchlist() {
    if (typeof window === "undefined") return DEFAULT_WATCHLIST;
    try {
        const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
        if (!raw) return DEFAULT_WATCHLIST;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
        const values = parsed.map((item) => normalizeSymbol(String(item))).filter(Boolean);
        return values.length ? Array.from(new Set(values)).slice(0, 20) : DEFAULT_WATCHLIST;
    } catch {
        return DEFAULT_WATCHLIST;
    }
}

function formatNumber(value: number | null | undefined, locale: string, fractionDigits = 2) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    return new Intl.NumberFormat(locale, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: numericValue % 1 === 0 ? 0 : Math.min(2, fractionDigits),
    }).format(numericValue);
}

function formatSignedNumber(value: number | null | undefined, locale: string, fractionDigits = 2) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    const formatted = formatNumber(Math.abs(numericValue), locale, fractionDigits);
    if (numericValue > 0) return `+${formatted}`;
    if (numericValue < 0) return `-${formatted}`;
    return formatted;
}

function formatCompact(value: number | null | undefined, locale: string) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(numericValue);
}

function toFiniteNumber(value: unknown) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function getQuoteTone(value: number | null | undefined) {
    const numericValue = Number(value);
    if (numericValue > 0) return "text-emerald-600 dark:text-emerald-400";
    if (numericValue < 0) return "text-rose-600 dark:text-rose-400";
    return "text-muted-foreground";
}

function getLabelForPoint(point: HistoryPoint, range: RangeKey, localeCode: string) {
    const date = new Date(point.time);
    if (range === "5m" || range === "15m" || range === "1h") {
        return new Intl.DateTimeFormat(localeCode, { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat(localeCode, { month: "2-digit", day: "2-digit" }).format(date);
}

function buildChartData(points: HistoryPoint[], range: RangeKey, localeCode: string) {
    return points.map((point) => ({
        ...point,
        label: getLabelForPoint(point, range, localeCode),
    }));
}

function getFreshnessLabel(value: string, localeCode: string) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return "--";
    return new Intl.DateTimeFormat(localeCode, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(parsed));
}

function getNextUtcResetLabel(localeCode: string) {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return new Intl.DateTimeFormat(localeCode, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        hour12: false,
    }).format(next);
}

function calculateSmaAt(points: Array<{ close: number }>, index: number, period: number) {
    if (index + 1 < period) return null;
    const slice = points.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, point) => sum + point.close, 0) / period;
}

function buildLinePath(
    points: Array<{ close: number }>,
    period: number,
    mapX: (index: number) => number,
    mapY: (value: number) => number
) {
    const commands: string[] = [];
    points.forEach((_, index) => {
        const value = calculateSmaAt(points, index, period);
        if (value === null) return;
        commands.push(`${commands.length ? "L" : "M"} ${mapX(index).toFixed(2)} ${mapY(value).toFixed(2)}`);
    });
    return commands.join(" ");
}

function CandlestickChart({
    data,
    currency,
    localeCode,
    isEnglish,
}: {
    data: Array<HistoryPoint & { label: string }>;
    currency: string;
    localeCode: string;
    isEnglish: boolean;
}) {
    const width = 1000;
    const height = 340;
    const padding = { top: 18, right: 74, bottom: 34, left: 18 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const safeData = data.filter((point) => Number.isFinite(point.close));

    if (!safeData.length) {
        return (
            <div className="flex h-full items-center justify-center rounded-lg border border-border bg-secondary/20 text-sm text-muted-foreground">
                {isEnglish ? "No chart data available." : "目前沒有可用的 K 線資料。"}
            </div>
        );
    }

    const highs = safeData.map((point) => Number(point.high ?? point.close));
    const lows = safeData.map((point) => Number(point.low ?? point.close));
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const pricePadding = Math.max((maxPrice - minPrice) * 0.08, maxPrice * 0.002, 1);
    const yMax = maxPrice + pricePadding;
    const yMin = Math.max(0, minPrice - pricePadding);
    const candleStep = plotWidth / Math.max(1, safeData.length - 1);
    const candleWidth = Math.max(4, Math.min(16, candleStep * 0.58));
    const gridLines = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const value = yMax - (yMax - yMin) * ratio;
        const y = padding.top + plotHeight * ratio;
        return { y, value };
    });

    const mapX = (index: number) => padding.left + index * candleStep;
    const mapY = (value: number) => padding.top + ((yMax - value) / Math.max(1, yMax - yMin)) * plotHeight;
    const sma5Path = buildLinePath(safeData, 5, mapX, mapY);
    const sma20Path = buildLinePath(safeData, 20, mapX, mapY);
    const last = safeData[safeData.length - 1];
    const currentPrice = Number(last?.close || 0);
    const currentPriceY = mapY(currentPrice);

    return (
        <div className="h-full rounded-lg border border-border bg-background">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={isEnglish ? "Candlestick chart" : "K 線圖"}>
                <rect x="0" y="0" width={width} height={height} fill="transparent" />
                {gridLines.map((line) => (
                    <g key={line.y}>
                        <line x1={padding.left} x2={width - padding.right + 10} y1={line.y} y2={line.y} className="stroke-border" strokeDasharray="4 6" />
                        <text x={width - padding.right + 18} y={line.y + 4} className="fill-muted-foreground text-[11px]">
                            {formatNumber(line.value, localeCode)}
                        </text>
                    </g>
                ))}
                {safeData.map((point, index) => {
                    const open = Number(point.open ?? point.close);
                    const close = Number(point.close);
                    const high = Number(point.high ?? Math.max(open, close));
                    const low = Number(point.low ?? Math.min(open, close));
                    const x = mapX(index);
                    const yHigh = mapY(high);
                    const yLow = mapY(low);
                    const yOpen = mapY(open);
                    const yClose = mapY(close);
                    const isUp = close >= open;
                    const color = isUp ? "#10b981" : "#ef4444";
                    const bodyY = Math.min(yOpen, yClose);
                    const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

                    return (
                        <g key={`${point.time}-${index}`}>
                            <title>
                                {`${point.label} O:${formatNumber(open, localeCode)} H:${formatNumber(high, localeCode)} L:${formatNumber(low, localeCode)} C:${formatNumber(close, localeCode)} V:${formatCompact(point.volume, localeCode)}`}
                            </title>
                            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth="2" />
                            <rect
                                x={x - candleWidth / 2}
                                y={bodyY}
                                width={candleWidth}
                                height={bodyHeight}
                                rx="1.5"
                                fill={isUp ? "rgba(16,185,129,0.22)" : "rgba(239,68,68,0.82)"}
                                stroke={color}
                                strokeWidth="2"
                            />
                        </g>
                    );
                })}
                {sma20Path && <path d={sma20Path} fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
                {sma5Path && <path d={sma5Path} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
                {Number.isFinite(currentPrice) && currentPrice > 0 && (
                    <g>
                        <line
                            x1={padding.left}
                            x2={width - padding.right + 10}
                            y1={currentPriceY}
                            y2={currentPriceY}
                            stroke="#22d3ee"
                            strokeWidth="1.6"
                            strokeDasharray="6 6"
                            opacity="0.95"
                        />
                        <rect
                            x={width - padding.right + 14}
                            y={currentPriceY - 10}
                            width={84}
                            height={20}
                            rx={6}
                            fill="rgba(8, 145, 178, 0.18)"
                            stroke="rgba(34, 211, 238, 0.85)"
                        />
                        <text x={width - padding.right + 56} y={currentPriceY + 4} textAnchor="middle" className="fill-cyan-300 text-[11px] font-semibold">
                            {formatNumber(currentPrice, localeCode)}
                        </text>
                    </g>
                )}
                <text x={padding.left} y={height - 12} className="fill-muted-foreground text-[11px]">
                    {safeData[0]?.label}
                </text>
                <text x={width - padding.right - 24} y={height - 12} textAnchor="end" className="fill-muted-foreground text-[11px]">
                    {safeData[safeData.length - 1]?.label}
                </text>
                <g transform={`translate(${padding.left}, 14)`}>
                    <circle cx="0" cy="0" r="4" fill="#f59e0b" />
                    <text x="10" y="4" className="fill-muted-foreground text-[11px]">SMA5</text>
                    <circle cx="64" cy="0" r="4" fill="#3b82f6" />
                    <text x="74" y="4" className="fill-muted-foreground text-[11px]">SMA20</text>
                    <text x="154" y="4" className="fill-muted-foreground text-[11px]">
                        {currency} {formatNumber(last.close, localeCode)}
                    </text>
                </g>
            </svg>
        </div>
    );
}

export default function CryptoAnalysisPage() {
    const { locale } = useI18n();
    const isEnglish = locale === "en";
    const localeCode = isEnglish ? "en-US" : "zh-TW";
    const toast = useToast();
    const { activeGolem } = useGolem();
    const [quotePreference, setQuotePreference] = useState<QuotePreference>(() => readStoredQuotePreference());

    const [watchlist, setWatchlist] = useState<string[]>(() => readStoredWatchlist());
    const [quotes, setQuotes] = useState<CryptoQuote[]>([]);
    const [quoteErrors, setQuoteErrors] = useState<Array<{ symbol: string; error: string }>>([]);
    const [selectedMarket, setSelectedMarket] = useState<MarketFilter>("all");
    const [selectedSymbol, setSelectedSymbol] = useState(() => readStoredWatchlist()[0] || "BTC-USDT");
    const [range, setRange] = useState<RangeKey>("5m");
    const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([]);
    const [indicators, setIndicators] = useState<CryptoIndicators | null>(null);
    const [news, setNews] = useState<CryptoNews | null>(null);
    const [query, setQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isLoadingQuotes, setIsLoadingQuotes] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isLoadingNews, setIsLoadingNews] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [sentSnapshot, setSentSnapshot] = useState(false);
    const [lastUpdatedAt, setLastUpdatedAt] = useState("");
    const [showSupportPrompt, setShowSupportPrompt] = useState(false);
    const [supportCopyIndex, setSupportCopyIndex] = useState(0);
    const [isFeatureEnabled, setIsFeatureEnabled] = useState(true);
    const [isSidebarHidden, setIsSidebarHidden] = useState(false);
    const [membership, setMembership] = useState<CryptoMembershipStatusResponse["membership"] | null>(null);
    const [loginEmail, setLoginEmail] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [isLoginLoading, setIsLoginLoading] = useState(false);
    const [accessGate, setAccessGate] = useState<AccessGateState | null>(null);
    const [isCheckingSponsor, setIsCheckingSponsor] = useState(false);
    const [isBenefitsModalOpen, setIsBenefitsModalOpen] = useState(false);
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const pendingRetryRef = useRef<null | (() => void)>(null);
    const lastInteractionRefreshRef = useRef(0);
    const newsCardRef = useRef<HTMLDivElement | null>(null);
    const [isNewsCardVisible, setIsNewsCardVisible] = useState(false);
    const isRuntimeActive = isFeatureEnabled && !isSidebarHidden;
    const isSponsorTier = (membership?.tier || "visitor") === "sponsor";
    const canUseAdvancedIndicators = Boolean(membership?.entitlements?.canUseAdvancedIndicators) && isSponsorTier;
    const refreshIntervalMs = Math.max(
        15_000,
        Number(membership?.entitlements?.refreshIntervalSecMin || (DEFAULT_AUTO_REFRESH_MS / 1000)) * 1000
    );
    const nextQuotaResetUtc = getNextUtcResetLabel(localeCode);

    const loadMembership = useCallback(async () => {
        try {
            const data = await apiGet<CryptoMembershipStatusResponse>(apiUrl("/api/crypto/membership/status"));
            setMembership(data.membership || null);
        } catch {
            setMembership(null);
        }
    }, []);

    const openAccessGate = useCallback((title: string, body: string, step: 1 | 2 = 1, note = "") => {
        setAccessGate({ title, body, step, note });
    }, []);

    const handleApiAccessError = useCallback((
        error: unknown,
        fallbackTitle: string,
        fallbackBody: string,
        retryAction?: (() => void) | null
    ) => {
        if (retryAction) pendingRetryRef.current = retryAction;
        if (!(error instanceof ApiError)) {
            openAccessGate(fallbackTitle, fallbackBody);
            return;
        }
        const payload = (error.payload && typeof error.payload === "object")
            ? (error.payload as Record<string, unknown>)
            : {};
        const code = String(payload.error || "");
        const tier = String(payload.tier || membership?.tier || "visitor");

        if (code === "general_membership_required") {
            openAccessGate(
                isEnglish ? "General membership required" : "需要一般會員以上",
                isEnglish
                    ? `Your current tier is ${tier}. Sponsor requires at least USD $5 and unlocks full crypto analysis features.`
                    : `你目前是 ${tier} 等級。贊助會員門檻為至少 5 美金，升級後可解鎖完整幣市分析功能。`
            );
            return;
        }
        if (code === "membership_range_limit") {
            const allowedUntil = String(payload.allowedUntil || "1d");
            openAccessGate(
                isEnglish ? "Range locked by membership tier" : "查詢區間受會員等級限制",
                isEnglish
                    ? `Your current tier supports history up to ${allowedUntil}. Sponsor (min USD $5) unlocks longer ranges.`
                    : `你目前會員僅支援到 ${allowedUntil}。贊助會員（至少 5 美金）可解鎖更長歷史區間。`
            );
            return;
        }
        if (code === "ai_insight_quota_exceeded") {
            const quota = (payload.quota && typeof payload.quota === "object")
                ? (payload.quota as Record<string, unknown>)
                : {};
            const limit = Number(quota.limit || 0);
            const used = Number(quota.used || limit);
            openAccessGate(
                isEnglish ? "Daily AI quota reached" : "今日 AI 配額已用完",
                isEnglish
                    ? `You have used ${used}/${limit} analyses today. Sponsor (min USD $5) gives a much higher daily quota.`
                    : `你今天已使用 ${used}/${limit} 次分析。贊助會員（至少 5 美金）可獲得更高每日配額。`
            );
            return;
        }
        if (code === "sponsor_membership_required") {
            openAccessGate(
                isEnglish ? "Sponsor-only feature" : "此功能限贊助會員",
                isEnglish
                    ? "This feature is available to Sponsor members only."
                    : "這項功能目前僅開放給贊助會員。"
            );
            return;
        }
        openAccessGate(fallbackTitle, fallbackBody);
    }, [isEnglish, membership?.tier, openAccessGate]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadMembership();
    }, [loadMembership]);

    useEffect(() => {
        const syncRuntimeFlags = () => {
            setIsFeatureEnabled(readFeatureEnabled(CRYPTO_FEATURE_ENABLED_STORAGE_KEY, true));
            setIsSidebarHidden(isDashboardRouteHidden(CRYPTO_DASHBOARD_HREF));
        };
        syncRuntimeFlags();
        window.addEventListener(DASHBOARD_FEATURE_FLAGS_UPDATED_EVENT, syncRuntimeFlags);
        window.addEventListener(SIDEBAR_NAV_HIDDEN_UPDATED_EVENT, syncRuntimeFlags);
        window.addEventListener("storage", syncRuntimeFlags);
        return () => {
            window.removeEventListener(DASHBOARD_FEATURE_FLAGS_UPDATED_EVENT, syncRuntimeFlags);
            window.removeEventListener(SIDEBAR_NAV_HIDDEN_UPDATED_EVENT, syncRuntimeFlags);
            window.removeEventListener("storage", syncRuntimeFlags);
        };
    }, []);

    useEffect(() => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    }, [watchlist]);

    useEffect(() => {
        localStorage.setItem(QUOTE_PREFERENCE_STORAGE_KEY, quotePreference);
    }, [quotePreference]);

    useEffect(() => {
        if (showSupportPrompt) return;
        const readSnoozedAt = () => Number(localStorage.getItem(SUPPORT_PROMPT_STORAGE_KEY) || 0);
        const scheduleDelay = () => {
            const elapsed = Date.now() - readSnoozedAt();
            if (elapsed >= SUPPORT_PROMPT_INTERVAL_MS) return SUPPORT_PROMPT_INITIAL_DELAY_MS;
            return SUPPORT_PROMPT_INTERVAL_MS - elapsed;
        };
        const timer = window.setTimeout(() => {
            setSupportCopyIndex((prev) => pickSupportCopyIndex(prev));
            setShowSupportPrompt(true);
        }, scheduleDelay());
        return () => window.clearTimeout(timer);
    }, [showSupportPrompt]);

    const loadQuotes = useCallback(async () => {
        if (!watchlist.length) return;
        setIsLoadingQuotes(true);
        try {
            const data = await apiGet<QuotesResponse>(apiUrl(`/api/crypto/quotes?symbols=${encodeURIComponent(watchlist.join(","))}`));
            const nextQuotes = Array.isArray(data.quotes) ? data.quotes : [];
            setQuotes(nextQuotes);
            setQuoteErrors(Array.isArray(data.errors) ? data.errors : []);
            setLastUpdatedAt(data.generatedAt || new Date().toISOString());
            if (nextQuotes.length && !nextQuotes.some((quote) => quote.yahooSymbol === selectedSymbol)) {
                setSelectedSymbol(nextQuotes[0].yahooSymbol);
            }
            return nextQuotes;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Failed to load quotes" : "讀取行情失敗", message);
            return [];
        } finally {
            setIsLoadingQuotes(false);
        }
    }, [isEnglish, selectedSymbol, toast, watchlist]);

    const loadHistory = useCallback(async (symbol: string, nextRange: RangeKey) => {
        const safeSymbol = normalizeSymbol(symbol, quotePreference);
        if (!safeSymbol) return;
        const rangeConfig = RANGE_MAP[nextRange];
        setIsLoadingHistory(true);
        try {
            const data = await apiGet<HistoryResponse>(
                apiUrl(`/api/crypto/history?symbol=${encodeURIComponent(safeSymbol)}&range=${rangeConfig.range}&interval=${rangeConfig.interval}`)
            );
            setHistoryPoints(Array.isArray(data.history?.points) ? data.history.points : []);
            setIndicators(data.history?.indicators || null);
            if (!data.history?.points?.length) {
                toast.warning(
                    isEnglish ? "No chart data" : "沒有走勢資料",
                    isEnglish ? "Yahoo Finance returned no valid OHLCV points for this symbol/range." : "Yahoo Finance 沒有回傳這個標的/區間可用的 OHLCV 資料。"
                );
            }
            return data.history || null;
        } catch (error) {
            setHistoryPoints([]);
            setIndicators(null);
            const message = error instanceof Error ? error.message : String(error);
            toast.warning(isEnglish ? "Failed to load chart" : "讀取走勢失敗", message);
            handleApiAccessError(
                error,
                isEnglish ? "Chart access limited" : "圖表權限受限",
                isEnglish ? "Upgrade membership to unlock broader chart capabilities." : "升級會員可解鎖更完整圖表能力。"
            );
            return null;
        } finally {
            setIsLoadingHistory(false);
        }
    }, [handleApiAccessError, isEnglish, quotePreference, toast]);

    const refreshDashboard = useCallback(async () => {
        await Promise.all([
            loadQuotes(),
            loadHistory(selectedSymbol, range),
        ]);
    }, [loadHistory, loadQuotes, range, selectedSymbol]);

    const loadNews = useCallback(async (quote: CryptoQuote | null) => {
        if (!quote?.yahooSymbol) {
            setNews(null);
            return null;
        }
        setIsLoadingNews(true);
        try {
            const data = await apiGet<NewsResponse>(
                apiUrl(`/api/crypto/news?symbol=${encodeURIComponent(quote.yahooSymbol)}&name=${encodeURIComponent(quote.name || quote.symbol)}`)
            );
            setNews(data.news || null);
            return data.news || null;
        } catch (error) {
            setNews(null);
            console.warn("[Crypto] Failed to load crypto news:", error);
            handleApiAccessError(
                error,
                isEnglish ? "News access limited" : "新聞權限受限",
                isEnglish ? "This news module needs a higher membership tier." : "此新聞模組需要更高會員等級。"
            );
            return null;
        } finally {
            setIsLoadingNews(false);
        }
    }, [handleApiAccessError, isEnglish]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadQuotes();
    }, [isRuntimeActive, loadQuotes]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadHistory(selectedSymbol, range);
    }, [isRuntimeActive, loadHistory, range, selectedSymbol]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        const tick = () => {
            if (typeof document !== "undefined" && document.hidden) return;
            refreshDashboard();
        };
        const timer = window.setInterval(tick, refreshIntervalMs);
        const handleVisibilityChange = () => {
            if (!document.hidden) refreshDashboard();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [isRuntimeActive, refreshDashboard, refreshIntervalMs]);

    const refreshOnInteraction = useCallback(() => {
        if (!isRuntimeActive) return;
        const now = Date.now();
        if (now - lastInteractionRefreshRef.current < refreshIntervalMs) return;
        lastInteractionRefreshRef.current = now;
        refreshDashboard();
    }, [isRuntimeActive, refreshDashboard, refreshIntervalMs]);

    useEffect(() => {
        const safeQuery = query.trim();
        if (!safeQuery) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSearchResults([]);
            setIsSearching(false);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            try {
                const data = await apiGet<SearchResponse>(apiUrl(`/api/crypto/search?q=${encodeURIComponent(safeQuery)}`));
                setSearchResults(Array.isArray(data.results) ? data.results : []);
            } catch {
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }, 280);
        return () => clearTimeout(timer);
    }, [query]);

    const visibleQuotes = useMemo(() => {
        return quotes.filter((quote) => selectedMarket === "all" || quote.market === selectedMarket);
    }, [quotes, selectedMarket]);

    const selectedQuote = useMemo(() => {
        return quotes.find((quote) => quote.yahooSymbol === selectedSymbol) ||
            quotes.find((quote) => quote.symbol === displaySymbol(selectedSymbol)) ||
            visibleQuotes[0] ||
            null;
    }, [quotes, selectedSymbol, visibleQuotes]);

    const searchPreview = useMemo(() => {
        const safeQuery = query.trim();
        if (!safeQuery) return null;
        const normalized = normalizeSymbol(safeQuery, quotePreference);
        return searchResults[0] || {
            symbol: displaySymbol(normalized),
            yahooSymbol: normalized,
            name: isSearching ? (isEnglish ? "Resolving from symbol directory..." : "正在從加密貨幣清單辨識...") : (isEnglish ? "No directory match yet" : "尚無清單匹配"),
            market: "crypto" as Market,
            exchange: "",
            type: "",
            dataSource: "input",
        };
    }, [isEnglish, isSearching, query, quotePreference, searchResults]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        if (!isSponsorTier) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadNews(selectedQuote);
    }, [isRuntimeActive, isSponsorTier, loadNews, selectedQuote]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        if (!isSponsorTier) return;
        if (!selectedQuote?.yahooSymbol || !isNewsCardVisible) return;
        const timer = window.setInterval(() => {
            loadNews(selectedQuote);
        }, NEWS_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [isNewsCardVisible, isRuntimeActive, isSponsorTier, loadNews, selectedQuote]);

    useEffect(() => {
        const target = newsCardRef.current;
        if (!target || typeof IntersectionObserver === "undefined") {
            setIsNewsCardVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                setIsNewsCardVisible(Boolean(entry?.isIntersecting));
            },
            { threshold: 0.2 }
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, []);

    const chartData = useMemo(() => buildChartData(historyPoints, range, localeCode), [historyPoints, localeCode, range]);

    const marketBreadth = useMemo(() => {
        const source = visibleQuotes.length ? visibleQuotes : quotes;
        const advancers = source.filter((quote) => quote.change > 0).length;
        const decliners = source.filter((quote) => quote.change < 0).length;
        const averageMove = source.reduce((sum, quote) => sum + quote.changePercent, 0) / Math.max(1, source.length);
        const totalTurnover = source.reduce((sum, quote) => sum + quote.turnover, 0);
        return { advancers, decliners, averageMove, totalTurnover, count: source.length };
    }, [quotes, visibleQuotes]);

    const snapshot = useMemo<CryptoDashboardSnapshot>(() => ({
        source: "dashboard-crypto-analysis",
        dataStatus: "live-market-data",
        marketFilter: selectedMarket,
        selectedRange: range,
        selected: selectedQuote,
        indicators,
        news,
        watchlist: visibleQuotes,
        breadth: marketBreadth,
        quoteErrors,
        generatedAt: new Date().toISOString(),
    }), [indicators, marketBreadth, news, quoteErrors, range, selectedMarket, selectedQuote, visibleQuotes]);

    useEffect(() => {
        if (!isRuntimeActive) return;
        if (!selectedQuote || !quotes.length) return;
        const timer = setTimeout(() => {
            apiPost(apiUrl("/api/crypto/snapshot"), { snapshot }).catch((error) => {
                console.warn("[Crypto] Failed to sync dashboard snapshot:", error);
            });
        }, 500);
        return () => clearTimeout(timer);
    }, [isRuntimeActive, quotes.length, selectedQuote, snapshot]);

    const addSymbol = (symbol: string) => {
        const safeSymbol = normalizeSymbol(symbol, quotePreference);
        if (!safeSymbol) return;
        const watchlistLimit = Math.max(3, Number(membership?.entitlements?.watchlistLimit || 3));
        setWatchlist((prev) => {
            if (prev.includes(safeSymbol)) return prev;
            return [safeSymbol, ...prev].slice(0, watchlistLimit);
        });
        setSelectedSymbol(safeSymbol);
        setQuery("");
        setSearchResults([]);
    };

    const removeSymbol = (symbol: string) => {
        setWatchlist((prev) => {
            const next = prev.filter((item) => item !== symbol);
            if (selectedSymbol === symbol && next[0]) setSelectedSymbol(next[0]);
            return next.length ? next : DEFAULT_WATCHLIST;
        });
    };

    const handleAskGolem = async () => {
        if (!activeGolem) {
            toast.warning(
                isEnglish ? "No active Golem" : "沒有可用的 Golem",
                isEnglish ? "Please start or select a Golem first." : "請先啟動或選擇一個 Golem。"
            );
            return;
        }
        const tier = membership?.tier || "visitor";
        if (tier === "visitor") {
            toast.warning(
                isEnglish ? "General membership required" : "需要一般會員以上",
                isEnglish ? "AI snapshot analysis starts from General membership." : "AI 看板分析從一般會員開始提供。"
            );
            pendingRetryRef.current = () => { void handleAskGolem(); };
            openAccessGate(
                isEnglish ? "Unlock AI board analysis" : "解鎖 AI 看板分析",
                isEnglish ? "Upgrade to Sponsor (min USD $5) to unlock full AI analysis quota and complete crypto features." : "升級贊助會員（至少 5 美金）可解鎖完整 AI 分析配額與全部幣市功能。"
            );
            return;
        }
        setIsSending(true);
        setSentSnapshot(false);
        try {
            await refreshDashboard();
            let snapshotForGolem = snapshot;
            try {
                const refreshed = await apiPost<SnapshotRefreshResponse>(apiUrl("/api/crypto/snapshot/refresh"), {
                    snapshot,
                    symbols: watchlist,
                    selectedSymbol,
                    selectedRange: range,
                    marketFilter: selectedMarket,
                    trigger: "dashboard-before-golem-analysis",
                });
                if (refreshed.snapshot) {
                    snapshotForGolem = refreshed.snapshot;
                    setLastUpdatedAt(refreshed.snapshot.generatedAt || new Date().toISOString());
                }
            } catch (refreshError) {
                const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
                toast.warning(
                    isEnglish ? "Using current snapshot" : "使用目前快照",
                    isEnglish ? `Live refresh failed: ${message}` : `即時刷新失敗：${message}`
                );
                handleApiAccessError(
                    refreshError,
                    isEnglish ? "Snapshot refresh limited" : "快照刷新受限",
                    isEnglish ? "Upgrade membership to continue high-frequency AI analysis." : "升級會員可繼續高頻 AI 分析。",
                    () => { void handleAskGolem(); }
                );
                return;
            }
            const symbolsForPrompt = Array.from(new Set([selectedSymbol, ...watchlist].map((symbol) => normalizeSymbol(symbol, quotePreference)).filter(Boolean)));
            const message = [
                `/cryptoboard ${symbolsForPrompt.join(" ")}`,
                isEnglish
                    ? "Analyze the current Dashboard crypto snapshot. The dashboard has synchronized the latest server-side structured snapshot; use that as the primary source, mention freshness, and avoid guaranteed financial advice."
                    : "請分析目前 Dashboard 加密貨幣看板。Dashboard 已先同步最新的 server-side 結構化快照；請以完整快照為主要資料來源，說明資料新鮮度，且不要做保證式投資建議。",
                snapshotForGolem?.generatedAt
                    ? `${isEnglish ? "Snapshot generated at" : "快照產生時間"}: ${snapshotForGolem.generatedAt}`
                    : "",
            ].filter(Boolean).join("\n");
            await apiPost(apiUrl("/api/chat"), { golemId: activeGolem, message });
            setSentSnapshot(true);
            toast.success(
                isEnglish ? "Snapshot sent" : "已送出看板快照",
                isEnglish ? "Golem is analyzing the live board in the console." : "Golem 會在控制台裡分析這份即時看板。"
            );
            loadMembership();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Send failed" : "送出失敗", message);
            handleApiAccessError(
                error,
                isEnglish ? "Feature access limited" : "功能權限受限",
                isEnglish ? "Upgrade membership to unlock this action." : "升級會員可解鎖此操作。"
            );
        } finally {
            setIsSending(false);
        }
    };

    const handleMembershipLogin = async () => {
        if (!loginEmail.trim() || !loginPassword.trim()) return;
        setIsLoginLoading(true);
        try {
            await apiPost(apiUrl("/api/crypto/membership/login"), {
                email: loginEmail.trim(),
                password: loginPassword,
            });
            setLoginPassword("");
            await loadMembership();
            setAccessGate(null);
            toast.success(isEnglish ? "Membership linked" : "會員已連結", isEnglish ? "Crypto permissions updated." : "Crypto 權限已更新。");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Login failed" : "登入失敗", message);
        } finally {
            setIsLoginLoading(false);
        }
    };

    const handleMembershipRegister = async () => {
        if (!loginEmail.trim() || !loginPassword.trim()) return;
        setIsLoginLoading(true);
        try {
            await apiPost(apiUrl("/api/crypto/membership/register"), {
                email: loginEmail.trim(),
                password: loginPassword,
            });
            setLoginPassword("");
            await loadMembership();
            setAccessGate(null);
            setIsAccountModalOpen(false);
            toast.success(isEnglish ? "Registration complete" : "註冊完成", isEnglish ? "Membership account is ready." : "會員帳號已建立並可使用。");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Registration failed" : "註冊失敗", message);
        } finally {
            setIsLoginLoading(false);
        }
    };

    const handleMembershipLogout = async () => {
        try {
            await apiPost(apiUrl("/api/crypto/membership/logout"), {});
            await loadMembership();
            toast.success(isEnglish ? "Logged out" : "已登出會員", isEnglish ? "Back to Visitor permissions." : "已回到訪客權限。");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Logout failed" : "登出失敗", message);
        }
    };

    const handleCheckSponsorStatus = async () => {
        setIsCheckingSponsor(true);
        try {
            const data = await apiGet<CryptoMembershipStatusResponse>(apiUrl("/api/crypto/membership/status"));
            const nextMembership = data.membership || null;
            setMembership(nextMembership);
            if (nextMembership?.tier === "sponsor") {
                setAccessGate(null);
                toast.success(
                    isEnglish ? "Sponsor unlocked" : "已啟用贊助會員",
                    isEnglish ? "Full crypto privileges are now active." : "完整 Crypto 權限已啟用。"
                );
                const retry = pendingRetryRef.current;
                pendingRetryRef.current = null;
                if (typeof retry === "function") retry();
                return;
            }
            setAccessGate((prev) => prev
                ? {
                    ...prev,
                    step: 2,
                    note: isEnglish
                        ? "Sponsor status not active yet. Please wait a moment and try check again."
                        : "目前尚未檢測到贊助資格，請稍候再按一次檢查。",
                }
                : prev);
            toast.warning(
                isEnglish ? "Sponsor not detected yet" : "尚未檢測到贊助資格",
                isEnglish ? "Please try again shortly." : "請稍後再試。"
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(isEnglish ? "Status check failed" : "狀態檢查失敗", message);
        } finally {
            setIsCheckingSponsor(false);
        }
    };

    const snoozeSupportPrompt = () => {
        localStorage.setItem(SUPPORT_PROMPT_STORAGE_KEY, String(Date.now()));
        setShowSupportPrompt(false);
    };
    const handleQuotePreferenceChange = (quote: QuotePreference) => {
        setQuotePreference(quote);
        setWatchlist((prev) => prev.map((symbol) => normalizeSymbol(symbol, quote)));
        setSelectedSymbol((prev) => normalizeSymbol(prev, quote));
    };
    const supportCopy = SUPPORT_COPY_VARIANTS[supportCopyIndex % SUPPORT_COPY_VARIANTS.length];

    return (
        <div className="min-h-full bg-background text-foreground" onPointerDown={refreshOnInteraction}>
            {accessGate && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border-2 border-amber-400/70 bg-card p-5 shadow-2xl">
                        <div className="mb-3 flex items-center gap-2 text-amber-400">
                            <Sparkles className="h-5 w-5" />
                            <span className="text-sm font-semibold">{isEnglish ? "Membership Upgrade" : "會員升級提示"}</span>
                        </div>
                        <h3 className="text-lg font-bold text-foreground">{accessGate.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{accessGate.body}</p>
                        {accessGate.step === 2 && accessGate.note && (
                            <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
                                {accessGate.note}
                            </div>
                        )}
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                            <Button
                                className="bg-amber-400 text-amber-950 hover:bg-amber-300"
                                asChild
                            >
                                <a
                                    href={SUPPORT_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() => setAccessGate((prev) => prev ? {
                                        ...prev,
                                        step: 2,
                                        note: isEnglish
                                            ? "After sponsoring, click “I have sponsored, check now”."
                                            : "完成贊助後，請按「我已贊助，立即檢查」。",
                                    } : prev)}
                                >
                                    <Coffee className="mr-2 h-4 w-4" />
                                    {isEnglish ? "Sponsor Now (USD $5+)" : "立即贊助升級（5 美金起）"}
                                </a>
                            </Button>
                            {accessGate.step === 2 ? (
                                <Button variant="secondary" onClick={handleCheckSponsorStatus} disabled={isCheckingSponsor}>
                                    {isCheckingSponsor
                                        ? (isEnglish ? "Checking..." : "檢查中...")
                                        : (isEnglish ? "I have sponsored, check now" : "我已贊助，立即檢查")}
                                </Button>
                            ) : (
                                <Button variant="secondary" onClick={() => setAccessGate(null)}>
                                    {isEnglish ? "Maybe later" : "稍後再說"}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {showSupportPrompt && (
                <div className="fixed right-4 top-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-amber-300/70 bg-card p-4 shadow-2xl shadow-amber-500/15 dark:border-amber-400/35">
                    <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/25">
                            <Coffee className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 space-y-3">
                            <div>
                                <div className="text-sm font-semibold text-foreground">
                                    {isEnglish ? supportCopy.enTitle : supportCopy.zhTitle}
                                </div>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                    {isEnglish ? supportCopy.enBody : supportCopy.zhBody}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Button className="bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/25 hover:bg-amber-300" asChild>
                                    <a
                                        href={SUPPORT_URL}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={snoozeSupportPrompt}
                                    >
                                        <Coffee className="mr-2 h-4 w-4" />
                                        {isEnglish ? supportCopy.enAction : supportCopy.zhAction}
                                    </a>
                                </Button>
                                <Button variant="ghost" onClick={snoozeSupportPrompt}>
                                    {isEnglish ? "Not this time" : "狠心不贊助"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 p-4 sm:p-5">
                <section className="flex flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                            <LineChart className="h-4 w-4" />
                            {isEnglish ? "Live Crypto Market Board" : "即時加密貨幣行情看板"}
                        </div>
                        <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
                            {isEnglish ? "Crypto Analysis" : "幣市分析"}
                        </h1>
                        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                            {isEnglish
                                ? "Track watchlists, inspect indicators, search symbols, and send a structured live snapshot to Golem."
                                : "追蹤自選幣、檢視技術指標、搜尋幣種，並把結構化即時快照交給 Golem 分析。"}
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {!isRuntimeActive && (
                            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                                {isEnglish
                                    ? "Background refresh paused (disabled in Settings or hidden in sidebar)."
                                    : "背景刷新已暫停（設定停用或側欄隱藏此頁）。"}
                            </div>
                        )}
                        <div className="inline-flex rounded-lg border border-border bg-card p-1">
                            {(["USDT", "USDC"] as QuotePreference[]).map((quote) => (
                                <button
                                    key={quote}
                                    type="button"
                                    onClick={() => handleQuotePreferenceChange(quote)}
                                    className={cn(
                                        "h-9 rounded-md px-3 text-sm font-semibold transition-colors",
                                        quotePreference === quote
                                            ? "bg-secondary text-foreground"
                                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                    )}
                                    title={isEnglish ? `Prefer ${quote} quote pairs` : `偏好 ${quote} 交易對`}
                                >
                                    {quote}
                                </button>
                            ))}
                        </div>
                        <div className="inline-flex rounded-lg border border-border bg-card p-1">
                            {[
                                { key: "all", label: isEnglish ? "All" : "全部" },
                                { key: "crypto", label: isEnglish ? "Crypto" : "加密貨幣" },
                            ].map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setSelectedMarket(option.key as MarketFilter)}
                                    className={cn(
                                        "h-9 rounded-md px-3 text-sm font-semibold transition-colors",
                                        selectedMarket === option.key
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <Button variant="secondary" onClick={refreshDashboard} disabled={isLoadingQuotes || isLoadingHistory}>
                            {isLoadingQuotes || isLoadingHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                            {isEnglish ? "Refresh" : "刷新"}
                        </Button>
                        <Button
                            className="border-amber-300 bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/25 ring-2 ring-amber-300/40 transition-all hover:bg-amber-300 hover:text-amber-950 dark:border-amber-300/70 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300 motion-safe:animate-pulse"
                            asChild
                        >
                            <a
                                href={SUPPORT_URL}
                                target="_blank"
                                rel="noreferrer"
                                onClick={snoozeSupportPrompt}
                            >
                                <Coffee className="mr-2 h-4 w-4" />
                                {isEnglish ? "Support" : "小額贊助"}
                            </a>
                        </Button>
                        <Button variant="secondary" onClick={() => setIsBenefitsModalOpen(true)}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            {isEnglish ? "Benefits" : "會員福利"}
                        </Button>
                        <Button variant="secondary" onClick={() => setIsAccountModalOpen(true)}>
                            <User className="mr-2 h-4 w-4" />
                            {membership?.authenticated ? (isEnglish ? "Account" : "會員帳號") : (isEnglish ? "Login / Register" : "登入 / 註冊")}
                        </Button>
                    </div>
                </section>

                <section className="grid gap-3 xl:grid-cols-[minmax(280px,0.9fr)_minmax(280px,1fr)_minmax(280px,1fr)]">
                    <Card ref={newsCardRef} className="rounded-lg border-border/80">
                        <CardContent className="flex gap-3 p-3">
                            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                                <div className="font-semibold text-foreground">{isEnglish ? "How to use" : "使用說明"}</div>
                                <p>{isEnglish ? `Search a symbol, select a watchlist row, then ask Golem. Quote preference is ${quotePreference}; current tier refreshes every ${Math.round(refreshIntervalMs / 1000)} seconds.` : `搜尋加密貨幣、點選自選股列，再請 Golem 分析。交易對偏好為 ${quotePreference}，目前會員層級每 ${Math.round(refreshIntervalMs / 1000)} 秒刷新。`}</p>
                                <p>{isEnglish ? "This board is not a second-level feed. For sub-second/second-level execution, use professional exchange trading software." : "本看板非秒級行情來源；若需秒級或亞秒級執行，請改用專業交易所交易軟體。"}</p>
                                <p>{isEnglish ? "Sponsor refresh is capped at 15 seconds to avoid upstream IP blocking." : "為避免資料源封鎖 IP，Sponsor 更新上限固定為每 15 秒一次。"}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="rounded-lg border-border/80">
                        <CardContent className="p-3 text-xs leading-5 text-muted-foreground">
                            <div className="font-semibold text-foreground">{isEnglish ? "Golem commands" : "Golem 指令"}</div>
                            <div className="mt-1 grid gap-1 sm:grid-cols-2">
                                <code className="rounded-md bg-secondary px-2 py-1">/cryptoboard BTC ETH SOL</code>
                                <code className="rounded-md bg-secondary px-2 py-1">分析 BTC ETH 幣市看板</code>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="rounded-lg border-border/80">
                        <CardContent className="flex gap-3 p-3">
                            <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                                <div className="font-semibold text-foreground">{isEnglish ? "News policy" : "新聞規則"}</div>
                                <p>{isEnglish ? "News search is Chinese-first, merges Yahoo/Google/DuckDuckGo sources, filters the latest 14 days, refreshes on symbol switch, and then hourly." : "新聞搜尋中文優先，會合併 Yahoo、Google、DuckDuckGo 來源，過濾最近 14 天；切換幣種時立即刷新，之後每小時更新。"}</p>
                            </div>
                        </CardContent>
                    </Card>

                </section>

                <section className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="pb-3">
                            <CardDescription>{isEnglish ? "Symbol Search" : "自選股搜尋"}</CardDescription>
                            <CardTitle className="text-xl">{isEnglish ? "Add crypto symbols" : "加入加密貨幣代號"}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <form
                                className="flex gap-2"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    addSymbol(query);
                                }}
                            >
                                <label className="relative min-w-0 flex-1">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        placeholder={isEnglish ? "BTC, ETH, SOL..." : "BTC、ETH、SOL..."}
                                        className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
                                    />
                                </label>
                                <Button type="submit" size="icon" title={isEnglish ? "Add symbol" : "加入標的"}>
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </form>

                            {searchPreview && (
                                <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="min-w-0">
                                            <span className="font-semibold">{isEnglish ? "Searching" : "正在搜尋"} {searchPreview.symbol}</span>
                                            <span className="ml-2 text-muted-foreground">{searchPreview.name}</span>
                                        </span>
                                        <span className="shrink-0 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                                            {isEnglish ? "Crypto" : "加密貨幣"}
                                            {searchPreview.exchange ? ` · ${searchPreview.exchange}` : ""}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {searchPreview.sector ? `${searchPreview.sector} · ` : ""}{searchPreview.dataSource}
                                    </div>
                                </div>
                            )}

                            <div className="max-h-[320px] min-h-[146px] overflow-y-auto rounded-lg border border-border bg-secondary/25">
                                {isSearching ? (
                                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {isEnglish ? "Searching..." : "搜尋中..."}
                                    </div>
                                ) : searchResults.length ? (
                                    <div className="divide-y divide-border/70">
                                        {searchResults.map((result) => (
                                            <button
                                                key={result.yahooSymbol}
                                                type="button"
                                                onClick={() => addSymbol(result.yahooSymbol)}
                                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                                            >
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-semibold">{result.symbol} · {result.name}</span>
                                                    <span className="block text-xs text-muted-foreground">{result.exchange || result.market.toUpperCase()} · {result.type}{result.sector ? ` · ${result.sector}` : ""} · {result.dataSource}</span>
                                                </span>
                                                <Plus className="h-4 w-4 text-muted-foreground" />
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex h-32 items-center justify-center px-4 text-center text-sm leading-6 text-muted-foreground">
                                        {isEnglish ? `Search by symbol or coin name. Inputs like BTC/ETH auto-normalize to -${quotePreference}.` : `可搜尋代號或幣種名稱。像 BTC/ETH 會自動正規化成 -${quotePreference}。`}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 md:grid-cols-3">
                        <Card className="rounded-lg border-border/80">
                            <CardHeader className="pb-3">
                                <CardDescription>{isEnglish ? "Selected" : "目前選取"}</CardDescription>
                                <CardTitle className="flex items-center justify-between text-xl">
                                    <span className="truncate">{selectedQuote?.name || "--"}</span>
                                    <span className="ml-3 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                                        {selectedQuote?.symbol || displaySymbol(selectedSymbol)}
                                    </span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="text-3xl font-semibold">
                                    {selectedQuote ? `${selectedQuote.currency} ${formatNumber(selectedQuote.price, localeCode)}` : "--"}
                                </div>
                                <div className={cn("flex items-center text-sm font-semibold", getQuoteTone(selectedQuote?.change))}>
                                    {(selectedQuote?.change || 0) >= 0 ? <ArrowUpRight className="mr-1 h-4 w-4" /> : <ArrowDownRight className="mr-1 h-4 w-4" />}
                                    {selectedQuote && selectedQuote.change >= 0 ? "+" : ""}
                                    {formatNumber(selectedQuote?.change, localeCode)} ({selectedQuote && selectedQuote.changePercent >= 0 ? "+" : ""}
                                    {formatNumber(selectedQuote?.changePercent, localeCode)}%)
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">
                                    {selectedQuote
                                        ? `${selectedQuote.dataSource}${selectedQuote.dataQuality === "stale-cache" ? (isEnglish ? " · stale cache" : " · 快取資料") : ""} · ${getFreshnessLabel(selectedQuote.lastUpdatedAt, localeCode)}`
                                        : isEnglish ? "No quote selected." : "尚未選取行情。"}
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="rounded-lg border-border/80">
                            <CardHeader className="pb-3">
                                <CardDescription>{isEnglish ? "Market Breadth" : "市場廣度"}</CardDescription>
                                <CardTitle className="text-xl">{isEnglish ? "Watchlist Pulse" : "自選股脈動"}</CardTitle>
                            </CardHeader>
                            <CardContent className="grid grid-cols-3 gap-3">
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                                    <div className="text-xs text-muted-foreground">{isEnglish ? "Up" : "上漲"}</div>
                                    <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">{marketBreadth.advancers}</div>
                                </div>
                                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
                                    <div className="text-xs text-muted-foreground">{isEnglish ? "Down" : "下跌"}</div>
                                    <div className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-400">{marketBreadth.decliners}</div>
                                </div>
                                <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                                    <div className="text-xs text-muted-foreground">{isEnglish ? "Avg" : "平均"}</div>
                                    <div className={cn("mt-1 text-2xl font-semibold", getQuoteTone(marketBreadth.averageMove))}>
                                        {marketBreadth.averageMove >= 0 ? "+" : ""}
                                        {formatNumber(marketBreadth.averageMove, localeCode)}%
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="rounded-lg border-border/80">
                            <CardHeader className="pb-3">
                                <CardDescription>{isEnglish ? "Golem Handoff" : "交給 Golem"}</CardDescription>
                                <CardTitle className="flex items-center gap-2 text-xl">
                                    <BrainCircuit className="h-5 w-5 text-primary" />
                                    {isEnglish ? "Analyze Board" : "分析看板"}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-sm leading-6 text-muted-foreground">
                                    {isEnglish
                                        ? "Send live quotes, indicators, search context, and watchlist breadth as a structured snapshot."
                                        : "把即時行情、技術指標、搜尋脈絡與自選股廣度整理成快照。"}
                                </p>
                                <Button className="w-full" onClick={handleAskGolem} disabled={isSending || !selectedQuote}>
                                    {sentSnapshot ? <Check className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                    {isSending ? (isEnglish ? "Sending..." : "送出中...") : (isEnglish ? "Ask Golem" : "請 Golem 分析")}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <CardDescription>{isEnglish ? "Candlestick Trend" : "K 線趨勢"}</CardDescription>
                                <CardTitle className="mt-1 text-xl">{selectedQuote?.symbol || displaySymbol(selectedSymbol)} · {selectedQuote?.name || "--"}</CardTitle>
                            </div>
                            <div className="inline-flex rounded-lg border border-border bg-background p-1">
                                {(Object.keys(RANGE_MAP) as RangeKey[]).map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => setRange(option)}
                                        className={cn(
                                            "h-8 min-w-10 rounded-md px-2 text-xs font-semibold transition-colors",
                                            range === option ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                        )}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="h-[340px]">
                                {isLoadingHistory ? (
                                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {isEnglish ? "Loading chart..." : "讀取走勢中..."}
                                    </div>
                                ) : (
                                    <CandlestickChart
                                        data={chartData}
                                        currency={selectedQuote?.currency || ""}
                                        localeCode={localeCode}
                                        isEnglish={isEnglish}
                                    />
                                )}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-4">
                                {[
                                    { label: isEnglish ? "Trend · SMA20" : "趨勢 · SMA20", value: formatNumber(indicators?.sma20, localeCode), locked: false },
                                    { label: "Momentum · RSI14", value: formatNumber(indicators?.rsi14, localeCode, 1), locked: false },
                                    { label: isEnglish ? "Day Range" : "日內區間", value: `${formatNumber(selectedQuote?.dayLow, localeCode)} - ${formatNumber(selectedQuote?.dayHigh, localeCode)}`, locked: false },
                                    { label: isEnglish ? "52W Range" : "52 週區間", value: `${formatNumber(selectedQuote?.fiftyTwoWeekLow, localeCode)} - ${formatNumber(selectedQuote?.fiftyTwoWeekHigh, localeCode)}`, locked: false },
                                    { label: isEnglish ? "Trend · EMA20" : "趨勢 · EMA20", value: formatNumber(indicators?.ema20, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Trend · EMA50" : "趨勢 · EMA50", value: formatNumber(indicators?.ema50, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Trend · EMA200" : "趨勢 · EMA200", value: formatNumber(indicators?.ema200, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: "Trend · MACD", value: formatNumber(indicators?.macd, localeCode, 2), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Trend · MACD Signal" : "趨勢 · MACD 訊號", value: formatNumber(indicators?.macdSignal, localeCode, 2), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Trend · MACD Hist" : "趨勢 · MACD 柱", value: formatNumber(indicators?.macdHistogram, localeCode, 2), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Trend · Vs SMA20" : "趨勢 · 距 SMA20", value: `${formatNumber(indicators?.distanceToSma20Percent, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: "Momentum · Stoch K", value: formatNumber(indicators?.stochasticK, localeCode, 1), locked: !canUseAdvancedIndicators },
                                    { label: "Momentum · Stoch D", value: formatNumber(indicators?.stochasticD, localeCode, 1), locked: !canUseAdvancedIndicators },
                                    { label: "Momentum · MFI14", value: formatNumber(indicators?.mfi14, localeCode, 1), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · ATR14" : "波動 · ATR14", value: formatNumber(indicators?.atr14, localeCode, 3), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Boll Mid" : "波動 · 布林中線", value: formatNumber(indicators?.bollingerMiddle, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Boll Upper" : "波動 · 布林上軌", value: formatNumber(indicators?.bollingerUpper, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Boll Lower" : "波動 · 布林下軌", value: formatNumber(indicators?.bollingerLower, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Boll Width" : "波動 · 布林寬度", value: `${formatNumber(indicators?.bollingerWidthPercent, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Hist Vol" : "波動 · 歷史波動", value: `${formatNumber(indicators?.volatility, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volatility · Drawdown" : "波動 · 最大回撤", value: `${formatNumber(indicators?.maxDrawdown, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Structure · Donchian High" : "結構 · 唐奇安高", value: formatNumber(indicators?.donchianUpper20, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Structure · Donchian Low" : "結構 · 唐奇安低", value: formatNumber(indicators?.donchianLower20, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Structure · Donchian Mid" : "結構 · 唐奇安中", value: formatNumber(indicators?.donchianMiddle20, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Structure · Dist to 52W High" : "結構 · 距 52W 高點", value: `${formatNumber(indicators?.distanceTo52wHighPercent, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Structure · Dist to 52W Low" : "結構 · 距 52W 低點", value: `${formatNumber(indicators?.distanceTo52wLowPercent, localeCode, 1)}%`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volume/Flow · OBV" : "量能/流向 · OBV", value: formatCompact(indicators?.obv, localeCode), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volume/Flow · Vol Ratio" : "量能/流向 · 量比", value: `${formatNumber(indicators?.volumeRatio, localeCode, 2)}x`, locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volume/Flow · Vol Z-Score" : "量能/流向 · 量能 Z 分數", value: formatNumber(indicators?.volumeZScore20, localeCode, 2), locked: !canUseAdvancedIndicators },
                                    { label: isEnglish ? "Volume/Flow · Avg Vol(20)" : "量能/流向 · 20 日均量", value: formatCompact(indicators?.avgVolume20, localeCode), locked: !canUseAdvancedIndicators },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        className={cn(
                                            "rounded-lg border p-3",
                                            item.locked
                                                ? "border-border/40 bg-muted/40 opacity-60"
                                                : "border-border bg-background"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                            <span>{item.label}</span>
                                            {item.locked && (
                                                <span className="rounded-full border border-amber-400/60 bg-amber-400/20 px-2 py-0.5 text-[10px] text-amber-200">
                                                    {isEnglish ? "Sponsor Unlock" : "贊助解鎖"}
                                                </span>
                                            )}
                                        </div>
                                        <div className={cn("mt-1 text-base font-semibold", item.locked && "blur-[1px]")}>
                                            {item.locked ? "•••" : item.value}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {!canUseAdvancedIndicators && (
                                <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
                                    {isEnglish
                                        ? "Advanced indicators are Sponsor-only. Upgrade to unlock full technical analysis."
                                        : "進階技術指標為贊助會員專屬（至少 5 美金），升級後可解鎖完整技術分析。"}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="space-y-4">
                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="pb-4">
                            <CardDescription>{isEnglish ? "Volume Shape" : "量能輪廓"}</CardDescription>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <BarChart3 className="h-5 w-5 text-primary" />
                                {isEnglish ? "Trading Activity" : "交易活躍度"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[280px] min-h-[280px] min-w-0">
                                {(
                                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                                        <BarChart data={chartData.slice(-24)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} className="text-xs" />
                                            <YAxis tickLine={false} axisLine={false} width={46} className="text-xs" tickFormatter={(value) => formatCompact(Number(value), localeCode)} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: "var(--color-popover)",
                                                    borderColor: "var(--color-border)",
                                                    borderRadius: 8,
                                                    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
                                                }}
                                                formatter={(value) => [formatCompact(toFiniteNumber(value), localeCode), isEnglish ? "Volume" : "成交量"]}
                                            />
                                            <Bar dataKey="volume" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                {[
                                    { label: isEnglish ? "Open" : "開盤", value: formatNumber(selectedQuote?.open, localeCode) },
                                    { label: isEnglish ? "Prev Close" : "昨收", value: formatNumber(selectedQuote?.previousClose, localeCode) },
                                    {
                                        label: isEnglish ? "Price Change" : "價格變動",
                                        value: `${selectedQuote?.currency || ""} ${formatSignedNumber(selectedQuote?.change, localeCode)}`.trim(),
                                        tone: getQuoteTone(selectedQuote?.change),
                                    },
                                    { label: isEnglish ? "Volume" : "成交量", value: formatCompact(selectedQuote?.volume, localeCode) },
                                    { label: isEnglish ? "Mkt Cap" : "市值", value: formatCompact(selectedQuote?.marketCap, localeCode) },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-lg border border-border bg-background p-3">
                                        <div className="text-xs text-muted-foreground">{item.label}</div>
                                        <div className={cn("mt-1 text-base font-semibold", item.tone)}>{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="pb-3">
                            <CardDescription>{isEnglish ? "Chinese-first news" : "中文優先新聞"}</CardDescription>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Newspaper className="h-5 w-5 text-primary" />
                                {selectedQuote ? `${selectedQuote.symbol} · ${selectedQuote.name}` : (isEnglish ? "Crypto News" : "幣種新聞")}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isSponsorTier ? (
                                <>
                                    <div className="rounded-lg border border-border bg-background p-3 text-xs leading-5 text-muted-foreground">
                                        {news?.dateWindow
                                            ? `${isEnglish ? "Query" : "查詢"}: ${news.query} · ${news.dateWindow.since} ~ ${news.dateWindow.until}`
                                            : isEnglish ? "News query adds a 14-day date window." : "新聞查詢會加入兩週內日期條件。"}
                                    </div>
                                    {isLoadingNews ? (
                                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {isEnglish ? "Searching news..." : "搜尋新聞中..."}
                                </div>
                                    ) : news?.results?.length ? (
                                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                                    {news.results.map((item) => (
                                        <a
                                            key={item.url}
                                            href={item.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/60"
                                        >
                                            <div className="line-clamp-2 text-sm font-semibold leading-5">{item.title}</div>
                                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.snippet || item.source}</div>
                                            {(item.publishedAt || item.source) && (
                                                <div className="mt-2 text-[11px] text-muted-foreground">
                                                    {item.source}{item.publishedAt ? ` · ${getFreshnessLabel(item.publishedAt, localeCode)}` : ""}
                                                </div>
                                            )}
                                        </a>
                                    ))}
                                </div>
                                    ) : (
                                <div className="rounded-lg border border-border bg-secondary/25 p-4 text-center text-sm text-muted-foreground">
                                    {isEnglish ? "No recent Chinese search results found." : "目前沒有找到兩週內中文優先搜尋結果。"}
                                </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200">
                                        {isEnglish ? "Sponsor-only module (USD $5+): News intelligence." : "贊助會員專屬模組（至少 5 美金）：新聞智慧摘要。"}
                                    </div>
                                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                                        {[1, 2, 3].map((idx) => (
                                            <div
                                                key={idx}
                                                className="rounded-lg border border-border/40 bg-muted/40 p-3 opacity-65"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="h-4 w-3/4 rounded bg-muted-foreground/20" />
                                                    <span className="rounded-full border border-amber-400/60 bg-amber-400/20 px-2 py-0.5 text-[10px] text-amber-200">
                                                        {isEnglish ? "Sponsor Unlock" : "贊助解鎖"}
                                                    </span>
                                                </div>
                                                <div className="mt-2 h-3 w-full rounded bg-muted-foreground/20" />
                                                <div className="mt-1 h-3 w-5/6 rounded bg-muted-foreground/20" />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-1">
                                        <Button
                                            className="bg-amber-400 text-amber-950 hover:bg-amber-300"
                                            onClick={() => openAccessGate(
                                                isEnglish ? "Unlock Crypto News Intelligence" : "解鎖加密新聞智慧摘要",
                                                isEnglish ? "Sponsor (USD $5+) unlocks news intelligence and full advanced indicator suite." : "升級贊助會員（至少 5 美金）可解鎖新聞智慧摘要與完整進階指標。",
                                                1
                                            )}
                                        >
                                            <Coffee className="mr-2 h-4 w-4" />
                                            {isEnglish ? "Upgrade to Sponsor (USD $5+)" : "升級贊助會員（5 美金起）"}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="gap-3 pb-4 md:flex-row md:items-center md:justify-between md:space-y-0">
                            <div>
                                <CardDescription>{isEnglish ? "Watchlist" : "自選股"}</CardDescription>
                                <CardTitle className="text-xl">{isEnglish ? "Live Crypto Symbols" : "即時加密貨幣標的"}</CardTitle>
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {lastUpdatedAt ? `${isEnglish ? "Updated" : "更新"} ${getFreshnessLabel(lastUpdatedAt, localeCode)}` : ""}
                            </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            <table className="w-full min-w-[1040px] text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                                        <th className="pb-3 font-semibold">{isEnglish ? "Symbol" : "代號"}</th>
                                        <th className="pb-3 font-semibold">{isEnglish ? "Market" : "市場"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "Price" : "價格"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "Price Change" : "價格變動"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "% Change" : "漲跌幅"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "Volume" : "成交量"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "Turnover" : "成交值"}</th>
                                        <th className="pb-3 font-semibold">{isEnglish ? "Source" : "來源"}</th>
                                        <th className="pb-3 text-right font-semibold">{isEnglish ? "Action" : "操作"}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {isLoadingQuotes && !quotes.length ? (
                                        <tr>
                                            <td colSpan={9} className="py-10 text-center text-muted-foreground">
                                                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                                                {isEnglish ? "Loading quotes..." : "讀取行情中..."}
                                            </td>
                                        </tr>
                                    ) : visibleQuotes.map((quote) => (
                                        <tr
                                            key={quote.yahooSymbol}
                                            onClick={() => setSelectedSymbol(quote.yahooSymbol)}
                                            className={cn(
                                                "cursor-pointer border-b border-border/70 transition-colors hover:bg-accent/60",
                                                selectedQuote?.yahooSymbol === quote.yahooSymbol && "bg-primary/10"
                                            )}
                                        >
                                            <td className="py-3">
                                                <div className="font-semibold">{quote.symbol}</div>
                                                <div className="max-w-[220px] truncate text-xs text-muted-foreground">{quote.name}</div>
                                            </td>
                                            <td className="py-3">
                                                <span className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                                                    {isEnglish ? "Crypto" : "加密貨幣"}
                                                </span>
                                            </td>
                                            <td className="py-3 text-right font-semibold">{quote.currency} {formatNumber(quote.price, localeCode)}</td>
                                            <td className={cn("py-3 text-right font-semibold", getQuoteTone(quote.change))}>
                                                {quote.currency} {formatSignedNumber(quote.change, localeCode)}
                                            </td>
                                            <td className={cn("py-3 text-right font-semibold", getQuoteTone(quote.change))}>
                                                {quote.changePercent >= 0 ? "+" : ""}
                                                {formatNumber(quote.changePercent, localeCode)}%
                                            </td>
                                            <td className="py-3 text-right text-muted-foreground">{formatCompact(quote.volume, localeCode)}</td>
                                            <td className="py-3 text-right text-muted-foreground">{formatCompact(quote.turnover, localeCode)}</td>
                                            <td className="py-3 text-muted-foreground">{quote.dataSource}</td>
                                            <td className="py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        removeSymbol(quote.yahooSymbol);
                                                    }}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                    title={isEnglish ? "Remove" : "移除"}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {quoteErrors.length > 0 && (
                                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-muted-foreground">
                                    {isEnglish ? "Some symbols failed:" : "部分標的讀取失敗："} {quoteErrors.map((item) => `${item.symbol}: ${item.error}`).join("; ")}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="rounded-lg border-border/80">
                        <CardHeader className="pb-3">
                            <CardDescription>{isEnglish ? "Snapshot Preview" : "快照預覽"}</CardDescription>
                            <CardTitle className="text-xl">{isEnglish ? "What Golem Reads" : "Golem 會讀到什麼"}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <pre className="max-h-[460px] overflow-auto rounded-lg border border-border bg-secondary/40 p-3 text-xs leading-5 text-muted-foreground">
                                {JSON.stringify(snapshot, null, 2)}
                            </pre>
                        </CardContent>
                    </Card>
                </section>
            </div>
            <Dialog open={isBenefitsModalOpen} onOpenChange={setIsBenefitsModalOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{isEnglish ? "Crypto Membership Benefits" : "Crypto 會員福利表"}</DialogTitle>
                        <DialogDescription>
                            {isEnglish
                                ? "Sponsor starts at USD $5. Crypto rules only."
                                : "贊助會員門檻為至少 5 美金。僅適用於 Crypto 功能。"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                            {isEnglish ? "Current tier" : "目前層級"}:
                            <span className="ml-2 font-semibold text-foreground">{membership?.tier || "visitor"}</span>
                            <span className="ml-2">{isEnglish ? `Refresh ${Math.round(refreshIntervalMs / 1000)}s` : `刷新 ${Math.round(refreshIntervalMs / 1000)} 秒`}</span>
                            <span className="ml-2">{isEnglish ? `AI quota reset: ${nextQuotaResetUtc} UTC` : `AI 配額重置：${nextQuotaResetUtc} UTC`}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left">
                                        <th className="py-2 pr-3">{isEnglish ? "Feature" : "項目"}</th>
                                        <th className="py-2 pr-3">Visitor</th>
                                        <th className="py-2 pr-3">General</th>
                                        <th className="py-2 pr-3">Sponsor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-b border-border/60">
                                        <td className="py-2 pr-3">{isEnglish ? "AI analysis quota/day" : "AI 分析配額/日"}</td>
                                        <td className="py-2 pr-3">0</td>
                                        <td className="py-2 pr-3">3</td>
                                        <td className="py-2 pr-3">120</td>
                                    </tr>
                                    <tr className="border-b border-border/60">
                                        <td className="py-2 pr-3">{isEnglish ? "Watchlist limit" : "自選上限"}</td>
                                        <td className="py-2 pr-3">3</td>
                                        <td className="py-2 pr-3">5</td>
                                        <td className="py-2 pr-3">100</td>
                                    </tr>
                                    <tr className="border-b border-border/60">
                                        <td className="py-2 pr-3">{isEnglish ? "Refresh interval" : "最快更新頻率"}</td>
                                        <td className="py-2 pr-3">60s</td>
                                        <td className="py-2 pr-3">30s</td>
                                        <td className="py-2 pr-3">15s (cap)</td>
                                    </tr>
                                    <tr>
                                        <td className="py-2 pr-3">{isEnglish ? "News / Advanced indicators" : "新聞 / 進階指標"}</td>
                                        <td className="py-2 pr-3">{isEnglish ? "Locked" : "鎖定"}</td>
                                        <td className="py-2 pr-3">{isEnglish ? "Locked" : "鎖定"}</td>
                                        <td className="py-2 pr-3">{isEnglish ? "Enabled" : "開放"}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {isEnglish
                                ? "Sponsor starts at USD $5, and refresh is capped at 15 seconds to protect upstream APIs."
                                : "贊助會員門檻為至少 5 美金，且刷新上限為 15 秒，以保護上游資料源。"}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <Dialog open={isAccountModalOpen} onOpenChange={setIsAccountModalOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{isEnglish ? "Membership Account" : "會員帳號"}</DialogTitle>
                        <DialogDescription>
                            {isEnglish ? "Use your email and password to register or login." : "使用 Email 與密碼進行註冊或登入。"}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="inline-flex rounded-lg border border-border bg-card p-1">
                            {([
                                { key: "login" as const, label: isEnglish ? "Login" : "登入" },
                                { key: "register" as const, label: isEnglish ? "Register" : "註冊" },
                            ]).map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setAuthMode(option.key)}
                                    className={cn(
                                        "h-9 rounded-md px-3 text-sm font-semibold transition-colors",
                                        authMode === option.key
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <input
                                type="email"
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                placeholder={isEnglish ? "Membership email" : "會員 Email"}
                                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                            />
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                placeholder={isEnglish ? "Password" : "密碼"}
                                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {authMode === "login" ? (
                                <Button onClick={handleMembershipLogin} disabled={isLoginLoading || !loginEmail.trim() || !loginPassword.trim()}>
                                    {isLoginLoading ? (isEnglish ? "Logging in..." : "登入中...") : (isEnglish ? "Login" : "登入")}
                                </Button>
                            ) : (
                                <Button onClick={handleMembershipRegister} disabled={isLoginLoading || !loginEmail.trim() || !loginPassword.trim()}>
                                    {isLoginLoading ? (isEnglish ? "Registering..." : "註冊中...") : (isEnglish ? "Register" : "註冊")}
                                </Button>
                            )}
                            {membership?.authenticated && (
                                <Button variant="secondary" onClick={handleMembershipLogout}>
                                    {isEnglish ? "Logout" : "登出"}
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                className="border-amber-400/50 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
                                asChild
                            >
                                <a href={SUPPORT_URL} target="_blank" rel="noreferrer">
                                    <Coffee className="mr-2 h-4 w-4" />
                                    {isEnglish ? "Upgrade to Sponsor (USD $5+)" : "升級贊助會員（5 美金起）"}
                                </a>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
