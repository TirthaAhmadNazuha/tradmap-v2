
import { existsSync, watch } from 'fs'
import { JSDOM } from 'jsdom'
import strftime from 'strftime'
import { uploadJson } from './lib/upload-s3.js'
import { readFile, unlink, readdir } from 'fs/promises'

const dir = 'data/downloads/'
async function parsing(eventType, filename) {
    if (eventType == 'rename' && !filename.endsWith('.crdownload') && existsSync(dir + filename)) {
        const data = await readFile(dir + filename)
        const { window } = new JSDOM(data)
        const document = window.document
        try {
            let country_source = document.querySelector('tr td center b').textContent
            if (country_source.includes('imported bt')) {
                country_source = country_source.split('imported by')[1].trim()
            } else country_source = 'World'
            const product_str = document.querySelector('tr:nth-child(2) td center').textContent.replace('Product:', '').trim().split(' ')
            const product_code = product_str.shift()
            const product_name = product_str.join(' ')
            const unit = document.querySelector('#ctl00_PageContent_Label_Unit').textContent.split(':')[1].trim()
            const rows = Array.from(document.querySelectorAll('#ctl00_PageContent_MyGridView1 tr'))
                .map(tr =>
                    Array.from(tr.children)
                        .map(td => td.textContent.trim())
                )
            const keys = rows.shift()
            const category = keys[3].includes('Exported') ? 'Export' : 'Import'
            const years = keys.map(str => str.split('value in ')[1]).filter(v => v);
            let i = 0
            for (const row of rows) {
                const dataToPush = []
                for (const index in years) {
                    const year = years[index]
                    dataToPush.push({
                        'link': null,
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
                    })
                }
                while (true) {
                    try {
                        await Promise.all(
                            dataToPush
                                .map(result => uploadJson(result.path_data_raw.replace('s3://ai-pipeline-statistics/', ''), result))
                        )
                        console.log(country_source, product_code, category, ++i, rows.length)
                        break
                    } catch (_) { }
                }
            }
        } catch (error) {
            console.log(error)
        } finally {
            try {
                await unlink(dir + filename)
            } catch (_) { }
            console.log('done.')
            await new Promise(r => setTimeout(r, 2000))
        }
    }
}

// watch('data/downloads', parsing)

(async () => {
    let dir = await readdir('data/downloads')
    while (true) {
        for (const file of dir) {
            console.log(file)
            await parsing('rename', file)
        }
        dir = await readdir('data/downloads')
        if (dir.length == 0) await new Promise(r => setTimeout(r, 10000))
    }
})()