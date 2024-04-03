import { launch } from 'puppeteer';
import { createInterface } from 'readline/promises';
import { writeFile } from 'fs/promises';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});
class TradmapCrawler {
  async start() {
    this.browser = await launch({
      headless: false,
      defaultViewport: null,
      userDataDir: 'data_browser',
    });
    this.page = (await this.browser.pages())[0];

  }

  async init() {
    await this.page.goto('https://www.trademap.org/Index.aspx', { waitUntil: 'load' });
    if (this.page.url().startsWith('https://www.trademap.org/Country_SelCountry_MQ_TS.aspx')) {
      return;
    }
    await (await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product')).click();
    await (await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product_DropDown > .ComboBoxItem_WebBlue')).click();
    const btnSubmit = await this.page.$('#ctl00_PageContent_Button_TimeSeries');
    await Promise.all([
      this.page.waitForNavigation(),
      btnSubmit.click()
    ]);
    const priodeSelect = await this.page.waitForSelector('select#ctl00_PageContent_GridViewPanelControl_DropDownList_NumTimePeriod');
    await Promise.all([
      this.page.waitForSelector(),
      priodeSelect.select('20'),
    ]);
    this.products = new Map();
    this.countries = new Map();
    await Promise.all([
      this.page.$$eval(
        '#ctl00_NavigationControl_DropDownList_Product > option',
        (opts) => opts
          .filter(opt => opt.value.length == 2)
          .forEach(opt => this.products.set(opt.textContent, opt.value)),
      ),
      this.page.$$eval(
        '#ctl00_NavigationControl_DropDownList_Country > option',
        (opts) => opts
          .forEach(opt => this.countries.set(opt.textContent, opt.value))
      ),
    ]);
  }

  async handler(country = 'World', onlyRowWorld = true) {
    if (country == 'World') {
      await Promise.all([
        this.page.waitForNavigation(),
        this.page.click('#ctl00_NavigationControl_RadioButton_World'),
      ]);
    } else {
      await this.page.click('#ctl00_NavigationControl_RadioButton_Country');
      await Promise.all([
        this.page.waitForNavigation(),
        this.page.select('#ctl00_NavigationControl_DropDownList_Country', this.countries.get(country))
      ]);
    }

    const rows = await this.extract(onlyRowWorld);
    console.log(rows);
  }

  async extract(onlyRowWorld) {
    if (onlyRowWorld) {
      return [
        await this.page.$eval('#ctl00_PageContent_MyGridView1 tr:nth-child(3)', (tr) => Array.from(tr.children).map(td => td.textContent))
      ];
    }
  }


  async main() {
    await this.start();
    try {
      await this.init();
      await this.handler();
    } catch (error) {
      console.error(error);
    } finally {
      await this.browser.close();
      process.exit(1);
    }
  }
}

new TradmapCrawler().main();
