import { launch } from 'puppeteer';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import strftime from 'strftime';
import { uploadJson } from './lib/upload-s3.js';

class TradmapCrawler {
  constructor() {
    this.country = process.argv[2]
    if (!this.country) {
      console.log('usage: node src/main.js <countryName or "world" or stateFileName>')
      process.exit(1)
    }
    console.log(this.country)
    this.main()
  }
  async start() {
    this.browser = await launch({
      // headless: false,
      // userDataDir: 'data_browser',
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
    await this.page.reload()
    try {
      await this.sleep(1000)
      await this.page.evaluate(() => {
        document.querySelector('#ctl00_PageContent_RadComboBox_Product_Input').value = ''
      })
      const box = await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product')
      await box.click()
      await (await this.page.waitForSelector('#ctl00_PageContent_RadComboBox_Product_DropDown > .ComboBoxItem_WebBlue')).click();
      const btnSubmit = await this.page.$('#ctl00_PageContent_Button_TimeSeries');
      await Promise.all([
        this.waitN('domcontentloaded', 40000),
        btnSubmit.click()
      ]);
      await this.page.reload({ waitUntil: 'domcontentloaded' })
      const priodeSelect = await this.page.waitForSelector('select#ctl00_PageContent_GridViewPanelControl_DropDownList_NumTimePeriod', { timeout: 60000 });
      const pageSelect = await this.page.$('#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize')
      await Promise.all([
        this.waitN(),
        priodeSelect.select('20'),
        pageSelect.select('300'),
      ]);

      console.log(await this.page.$eval('#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize option[selected]', (opt) => opt.getAttribute('value')))

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
      throw err
    }
  }

  sleep(timeout = 500) {
    return new Promise((r) => setTimeout(r, timeout))
  }

  async handler() {
    let products = this.product
    let country_ = this.country
    try {
      if (existsSync(`${this.country}_state.txt`)) {
        const data_state = (await readFile(`${this.country}_state.txt`)).toString()
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
      try {
        await this.page.reload({ waitUntil: 'domcontentloaded' })
        await Promise.all([
          this.waitN(),
          this.page.select('#ctl00_NavigationControl_DropDownList_Product', product),
          this.page.select('#ctl00_NavigationControl_DropDownList_TradeType', 'E'),
        ])

        console.log('selected', product)
        await this.parsing()

        console.log((await Promise.all([
          this.waitN(),
          this.page.select('#ctl00_NavigationControl_DropDownList_TradeType', 'I'),
        ]))[0]?.status())

        await this.parsing()
        await writeFile(`${this.country}_state.txt`, `${country_}:${product}`)
      } catch (error) {
        console.log(error.message)
        console.log(`cannot find ${product}`)
      }
    }
    console.log('ends')
  }

  async parsing() {
    await this.waitN()
    while (true) {
      try {
        const { category, country_source, years, product_name, product_code, unit, rows } = await this.page.evaluate((country) => {
          const rows = Array.from(document.querySelectorAll('#ctl00_PageContent_MyGridView1 tr'))
            .map(tr =>
              Array.from(tr.children)
                .map(td => td.textContent.trim()).slice(1)
            ).slice(2, -2)
          const keys = rows.shift()
          const category = document.querySelector('#ctl00_NavigationControl_DropDownList_TradeType option[selected]').textContent.trim()
          const years = keys.map(str => str.split('value in ')[1]).filter(v => v);
          const unit = document.querySelector('#ctl00_PageContent_Label_Unit').textContent.split(':')[1].trim()
          let country_source = null
          if (country == 'world') {
            country_source = 'World'
          } else {
            country_source = document.querySelector('#ctl00_NavigationControl_DropDownList_Country option[selected]').getAttribute('title')
          }
          const product = document.querySelector('#ctl00_NavigationControl_DropDownList_Product option[selected]')
          const [product_name, product_code] = [
            product.getAttribute('title'),
            product.getAttribute('value'),
          ]
          return {
            category, country_source, years, product_name, product_code, unit, rows
          }
        }, this.country.toLowerCase())

        const link = this.page.url()

        for (const row of rows) {
          console.clear()
          for (const index in years) {
            const year = years[index]
            const result = {
              'link': link,
              'domain': 'trademap.org',
              'tags': ['trademap.org', category, product_name],
              'crawling_time': strftime('%Y-%m-%d %H:%M:%S'),
              'crawling_time_epoch': Date.now(),
              'path_data_raw': `s3://ai-pipeline-statistics/data/data_raw/trademap/yearly/${category}/${year}/${[country_source, row[0], product_name, unit].join('_').replaceAll(" ", "-")}.json`,
              'path_data_clean': `s3://ai-pipeline-statistics/data/data_clean/trademap/yearly/${category}/${year}/${[country_source, row[0], product_name, unit].join('_').replaceAll(" ", "-")}.json`,
              'country_source': country_source,
              'country_target': row[0],
              'product_name': product_name,
              'product_code': product_code,
              'year': year,
              'category': category,
              'value': row[Number(index) + 1],
              'unit': unit
            }
            while (true) {
              try {
                await uploadJson(result.path_data_raw.replace('s3://ai-pipeline-statistics/', ''), result)
                console.log(result.path_data_raw)
                break
              } catch (_) { }
            }
          }
        }
        break
      } catch (error) {
        console.log(error)
        await this.page.reload({ waitUntil: 'domcontentloaded' })
      }
    }
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

