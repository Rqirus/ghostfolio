import { AssetClass, AssetSubClass, DataSource } from '@prisma/client';
import { format, subDays } from 'date-fns';

import { StockApiService } from './stock-api.service';

const TEST_SYMBOL = 'SH600519';
const SEARCH_QUERY = '贵州茅台';
const REQUEST_TIMEOUT_MS = 60_000;

describe('StockApiService (integration)', () => {
  let stockApiService: StockApiService;

  beforeAll(() => {
    jest.setTimeout(REQUEST_TIMEOUT_MS);
    stockApiService = new StockApiService();
  });

  it('getName should return STOCK_API', () => {
    expect(stockApiService.getName()).toEqual(DataSource.STOCK_API);
  });

  it('getDataProviderInfo should expose provider metadata', () => {
    expect(stockApiService.getDataProviderInfo()).toEqual({
      dataSource: DataSource.STOCK_API,
      isPremium: false,
      name: 'Stock API (A-Share)',
      url: 'https://github.com/zhangxiangliang/stock-api'
    });
  });

  it('getTestSymbol should return a supported A-share code', () => {
    expect(stockApiService.getTestSymbol()).toEqual(TEST_SYMBOL);
  });

  it('search should return A-share lookup items from stock-api', async () => {
    const { items } = await stockApiService.search({ query: SEARCH_QUERY });

    expect(items.length).toBeGreaterThan(0);

    const maotai = items.find(({ symbol }) => {
      return symbol === TEST_SYMBOL;
    });

    expect(maotai).toBeDefined();
    expect(maotai).toMatchObject({
      assetClass: AssetClass.EQUITY,
      assetSubClass: AssetSubClass.STOCK,
      currency: 'CNY',
      dataSource: DataSource.STOCK_API,
      name: expect.any(String),
      symbol: TEST_SYMBOL
    });
  });

  it('getQuotes should return a positive market price', async () => {
    const quotes = await stockApiService.getQuotes({
      symbols: [TEST_SYMBOL]
    });

    expect(quotes[TEST_SYMBOL]).toBeDefined();
    expect(quotes[TEST_SYMBOL].currency).toEqual('CNY');
    expect(quotes[TEST_SYMBOL].dataSource).toEqual(DataSource.STOCK_API);
    expect(quotes[TEST_SYMBOL].marketPrice).toBeGreaterThan(0);
    expect(['closed', 'delayed', 'open']).toContain(
      quotes[TEST_SYMBOL].marketState
    );
  });

  it('getAssetProfile should return symbol metadata', async () => {
    const assetProfile = await stockApiService.getAssetProfile({
      symbol: TEST_SYMBOL
    });

    expect(assetProfile).toMatchObject({
      assetClass: AssetClass.EQUITY,
      assetSubClass: AssetSubClass.STOCK,
      currency: 'CNY',
      dataSource: DataSource.STOCK_API,
      symbol: TEST_SYMBOL
    });
    expect(assetProfile.name?.length).toBeGreaterThan(0);
  });

  it('getHistorical should return daily market prices in range', async () => {
    const to = subDays(new Date(), 1);
    const from = subDays(to, 20);

    const historical = await stockApiService.getHistorical({
      from,
      symbol: TEST_SYMBOL,
      to
    });

    const prices = historical[TEST_SYMBOL];

    expect(prices).toBeDefined();

    const dates = Object.keys(prices);

    expect(dates.length).toBeGreaterThan(0);

    const fromDate = format(from, 'yyyy-MM-dd');
    const toDate = format(to, 'yyyy-MM-dd');

    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date >= fromDate && date <= toDate).toBe(true);
      expect(prices[date].marketPrice).toBeGreaterThan(0);
    }
  });

  it('getDividends should return an empty object', async () => {
    const dividends = await stockApiService.getDividends({
      from: subDays(new Date(), 365),
      symbol: TEST_SYMBOL,
      to: new Date()
    });

    expect(dividends).toEqual({});
  });
});
