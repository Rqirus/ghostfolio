import {
  DataProviderInterface,
  GetAssetProfileParams,
  GetDividendsParams,
  GetHistoricalParams,
  GetQuotesParams,
  GetSearchParams
} from '@ghostfolio/api/services/data-provider/interfaces/data-provider.interface';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import {
  DataProviderHistoricalResponse,
  DataProviderInfo,
  DataProviderResponse,
  LookupItem,
  LookupResponse
} from '@ghostfolio/common/interfaces';
import { MarketState } from '@ghostfolio/common/types';

import { Injectable, Logger } from '@nestjs/common';
import {
  AssetClass,
  AssetSubClass,
  DataSource,
  SymbolProfile
} from '@prisma/client';
import { differenceInCalendarDays, format } from 'date-fns';
import { stocks } from 'stock-api';

const A_SHARE_CODE_PATTERN = /^(SH|SZ)\d{6}$/;

@Injectable()
export class StockApiService implements DataProviderInterface {
  private readonly logger = new Logger(StockApiService.name);

  public canHandle() {
    return true;
  }

  public async getAssetProfile({
    symbol
  }: GetAssetProfileParams): Promise<Partial<SymbolProfile>> {
    if (!this.isSupportedSymbol(symbol)) {
      return undefined;
    }

    try {
      const stock = await stocks.auto.getStock(symbol);
      const { assetClass, assetSubClass } = this.parseAssetClass(stock);

      return {
        assetClass,
        assetSubClass,
        currency: this.getCurrencyForSymbol(symbol),
        dataSource: this.getName(),
        name: stock.name,
        symbol
      };
    } catch (error) {
      this.logger.error(
        `Could not get asset profile for ${symbol} (${this.getName()}): [${error.name}] ${error.message}`
      );

      return {
        currency: this.getCurrencyForSymbol(symbol),
        dataSource: this.getName(),
        symbol
      };
    }
  }

  public getDataProviderInfo(): DataProviderInfo {
    return {
      dataSource: DataSource.STOCK_API,
      isPremium: false,
      name: 'Stock API (A-Share)',
      url: 'https://github.com/zhangxiangliang/stock-api'
    };
  }

  public async getDividends({}: GetDividendsParams) {
    return {};
  }

  public async getHistorical({
    from,
    symbol,
    to
  }: GetHistoricalParams): Promise<{
    [symbol: string]: { [date: string]: DataProviderHistoricalResponse };
  }> {
    if (!this.isSupportedSymbol(symbol)) {
      return { [symbol]: {} };
    }

    try {
      const fromDate = format(from, DATE_FORMAT);
      const toDate = format(to, DATE_FORMAT);
      const count = Math.min(
        Math.max(differenceInCalendarDays(to, from) + 30, 120),
        5000
      );

      const klines = await stocks.auto.getKlines(symbol, {
        adjust: 'hfq',
        count,
        period: 'day'
      });

      const response: {
        [symbol: string]: { [date: string]: DataProviderHistoricalResponse };
      } = {
        [symbol]: {}
      };

      for (const { close, date } of klines) {
        if (date >= fromDate && date <= toDate) {
          response[symbol][date] = {
            marketPrice: close
          };
        }
      }

      return response;
    } catch (error) {
      throw new Error(
        `Could not get historical market data for ${symbol} (${this.getName()}) from ${format(
          from,
          DATE_FORMAT
        )} to ${format(to, DATE_FORMAT)}: [${error.name}] ${error.message}`
      );
    }
  }

  public getMaxNumberOfSymbolsPerRequest() {
    return 50;
  }

  public getName(): DataSource {
    return DataSource.STOCK_API;
  }

  public async getQuotes({
    symbols
  }: GetQuotesParams): Promise<{ [symbol: string]: DataProviderResponse }> {
    const response: { [symbol: string]: DataProviderResponse } = {};

    const supportedSymbols = symbols.filter((symbol) => {
      return this.isSupportedSymbol(symbol);
    });

    if (supportedSymbols.length <= 0) {
      return response;
    }

    try {
      const quotes = await stocks.auto.getStocks(supportedSymbols);

      for (const quote of quotes) {
        response[quote.code] = {
          currency: this.getCurrencyForSymbol(quote.code),
          dataSource: this.getName(),
          marketPrice: quote.now,
          marketState: this.getMarketState(quote.code)
        };
      }
    } catch (error) {
      this.logger.error(
        `Could not get quotes for ${supportedSymbols.join(', ')} (${this.getName()}): [${error.name}] ${error.message}`
      );
    }

    return response;
  }

  public getTestSymbol() {
    return 'SH600519';
  }

  public async search({ query }: GetSearchParams): Promise<LookupResponse> {
    let items: LookupItem[] = [];

    if (!query?.trim()) {
      return { items };
    }

    try {
      const results = await stocks.auto.searchStocks(query.trim());

      items = results
        .filter(({ code }) => {
          return A_SHARE_CODE_PATTERN.test(code);
        })
        .map(({ code, name }) => {
          const { assetClass, assetSubClass } = this.parseAssetClass({
            code,
            name
          });

          return {
            assetClass,
            assetSubClass,
            currency: this.getCurrencyForSymbol(code),
            dataProviderInfo: this.getDataProviderInfo(),
            dataSource: this.getName(),
            name,
            symbol: code
          };
        });
    } catch (error) {
      this.logger.error(
        `Could not search for ${query} (${this.getName()}): [${error.name}] ${error.message}`
      );
    }

    return { items };
  }

  private getCurrencyForSymbol(symbol: string) {
    if (symbol.startsWith('HK')) {
      return 'HKD';
    }

    if (symbol.startsWith('US')) {
      return 'USD';
    }

    return 'CNY';
  }

  private getMarketState(symbol: string): MarketState {
    if (!A_SHARE_CODE_PATTERN.test(symbol)) {
      return 'delayed';
    }

    const now = new Date();
    const chinaTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
    );
    const day = chinaTime.getDay();

    if (day === 0 || day === 6) {
      return 'closed';
    }

    const minutes = chinaTime.getHours() * 60 + chinaTime.getMinutes();
    const isMorningSession = minutes >= 570 && minutes <= 690;
    const isAfternoonSession = minutes >= 780 && minutes <= 900;

    return isMorningSession || isAfternoonSession ? 'open' : 'closed';
  }

  private isSupportedSymbol(symbol: string) {
    return /^(HK|SH|SZ|US)/.test(symbol);
  }

  private parseAssetClass({ code, name }: { code: string; name: string }): {
    assetClass: AssetClass;
    assetSubClass: AssetSubClass;
  } {
    const normalizedName = name?.toUpperCase() ?? '';

    if (
      normalizedName.includes('ETF') ||
      normalizedName.includes('基金') ||
      /^SH(5|51|56|58|59)\d{4}$/.test(code) ||
      /^SZ(15|16|18)\d{4}$/.test(code)
    ) {
      return {
        assetClass: AssetClass.EQUITY,
        assetSubClass: AssetSubClass.ETF
      };
    }

    return {
      assetClass: AssetClass.EQUITY,
      assetSubClass: AssetSubClass.STOCK
    };
  }
}
