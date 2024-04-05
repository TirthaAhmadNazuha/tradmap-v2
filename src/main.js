import { launch } from 'puppeteer';
import { createInterface } from 'readline/promises';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});
class TradmapCrawler {
  constructor() {
    this.country = process.argv[2]
    if (!this.country) {
      console.log('usage: node src/main.js <countryName or "world">')
      process.exit(1)
    }
    console.log(this.country)
    this.main()
  }
  async start() {
    this.browser = await launch({
      userDataDir: 'data_browser',
      args: [
        '--no-sandbox'
      ]
    });
    this.page = (await this.browser.pages())[0];
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    await this.page.setUserAgent(ua)
    const client = await this.page.createCDPSession();

    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: 'data/downloads',
    });

  }

  async open(url) {
    try {
      return await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 })
    } catch (_) { }
  }

  async waitN(waitUntil = 'domcontentloaded', timeout = 12000) {
    try {
      return await this.page.waitForNavigation({ waitUntil, timeout })
    } catch (_) { }
  }

  async init() {
    await this.open('https://www.trademap.org/Index.aspx')
    try {
      if (this.page.url().includes('Cookie')) {
        await Promise.all([
          this.page.click('#ctl00_MenuControl_CheckBox_DoNotShowAgain'),
          this.waitN(),
          this.page.click('#ctl00_MenuControl_div_Button_ClosePopupNews > input'),
        ])
      }
      let box = await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product')
      await Promise.all([
        this.waitN(),
        box.click(),
      ])
      await this.sleep(2000)
      box = await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product')
      await box.click()
      await (await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product_DropDown > .ComboBoxItem_WebBlue')).click();
      const btnSubmit = await this.page.$('#ctl00_PageContent_Button_TimeSeries');
      await Promise.all([
        this.waitN('domcontentloaded', 40000),
        btnSubmit.click()
      ]);
      const priodeSelect = await this.page.waitForSelector('select#ctl00_PageContent_GridViewPanelControl_DropDownList_NumTimePeriod', { timeout: 60000 });
      await Promise.all([
        this.waitN(),
        priodeSelect.select('20'),
      ]);
      const [product, countries] = await Promise.all([
        this.page.$$eval(
          '#ctl00_NavigationControl_DropDownList_Product > option',
          (opts) => opts
            .filter(opt => opt.value.length == 2)
            .map(opt => opt.value),
        ),
        this.page.$$eval(
          '#ctl00_NavigationControl_DropDownList_Country > option',
          (opts) => opts
            .map(opt => [opt.textContent, opt.value])
        ),
      ]);
      this.product = product
      this.countries = new Map(countries)
    } catch (err) {
      console.log(err)
      await this.page.screenshot({ type: 'jpeg', path: `screenshots/_${new Date().toUTCString()}.jpeg` })
    }
  }

  sleep(timeout = 500) {
    return new Promise((r) => setTimeout(r, timeout))
  }

  async handler() {
    let products = this.product
    let country_ = this.country
    try {
      if (existsSync('state.txt')) {
        const data_state = (await readFile('state.txt')).toString()
        if (data_state.includes(':')) {
          const [country, product_code] = data_state.split(':')
          country_ = country
          console.log(country_, product_code)
          products = this.product.slice(this.product.findIndex((code) => code == product_code))
          if (country_ == 'world') {
            await Promise.all([
              this.waitN('load', 4000),
              this.page.click('#ctl00_NavigationControl_RadioButton_World'),
            ]);
          } else {
            await this.page.click('#ctl00_NavigationControl_RadioButton_Country');
            await Promise.all([
              this.waitN(),
              this.page.select('#ctl00_NavigationControl_DropDownList_Country', this.countries.get(country_))
            ]);
          }
        }
      } else {
        if (this.country.toLowerCase() == 'world') {
          await Promise.all([
            this.waitN('load', 4000),
            this.page.click('#ctl00_NavigationControl_RadioButton_World'),
          ]);
        } else {
          await this.page.click('#ctl00_NavigationControl_RadioButton_Country');
          await Promise.all([
            this.waitN(),
            this.page.select('#ctl00_NavigationControl_DropDownList_Country', this.countries.get(this.country))
          ]);
        }
      }
    } catch (error) {
      console.log(error)
    }
    console.log('finding')
    for (const product of products) {
      await Promise.all([
        this.waitN(),
        this.page.select('#ctl00_NavigationControl_DropDownList_Product', product),
        this.page.select('#ctl00_NavigationControl_DropDownList_TradeType', 'E'),
      ])
      console.log('selected', product)
      await (await this.page.waitForSelector('#ctl00_PageContent_GridViewPanelControl_ImageButton_ExportExcel')).click()

      await Promise.all([
        this.waitN(),
        this.page.select('#ctl00_NavigationControl_DropDownList_TradeType', 'I'),
      ])

      await (await this.page.waitForSelector('#ctl00_PageContent_GridViewPanelControl_ImageButton_ExportExcel')).click()
      await this.sleep(2000)
      await writeFile('state.txt', `${country_}:${product}`)
    }
    console.log('ends')
  }

  async main() {
    await this.start();
    try {
      await this.init();
      await this.sleep(2000)
      await this.handler()
      await this.sleep(1000)
    } catch (error) {
      console.error(error);
    } finally {
      await this.browser.close();
      process.exit(1);
    }
  }
}
new TradmapCrawler();

