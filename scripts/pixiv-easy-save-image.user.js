// ==UserScript==
// @name         Pixiv easy save image
// @name:zh-TW   Pixiv 簡單存圖
// @name:zh-CN   Pixiv 简单存图
// @namespace    https://blog.maple3142.net/
// @version      0.4.3
// @description  Save pixiv image easily with custom name format and shortcut key.
// @description:zh-TW  透過快捷鍵與自訂名稱格式來簡單的存圖
// @description:zh-CN  透过快捷键与自订名称格式来简单的存图
// @author       maple3142
// @require      https://greasyfork.org/scripts/370765-gif-js-for-user-js/code/gifjs%20for%20userjs.js?version=616920
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://unpkg.com/xfetch-js@0.0.9/xfetch.min.js
// @require      https://unpkg.com/gmxhr-fetch@0.0.3/gmxhr-fetch.min.js
// @match        https://www.pixiv.net/member_illust.php?mode=medium&illust_id=*
// @match        https://www.pixiv.net/
// @match        https://www.pixiv.net/bookmark.php*
// @match        https://www.pixiv.net/new_illust.php*
// @match        https://www.pixiv.net/bookmark_new_illust.php*
// @match        https://www.pixiv.net/ranking.php*
// @match        https://www.pixiv.net/search.php*
// @match        https://www.pixiv.net/member_illust.php*
// @connect      pximg.net
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @compatible   firefox >=52
// @compatible   chrome >=55
// @license      MIT
// ==/UserScript==

;(function() {
	'use strict'
	const FORMAT = {
		single: '{{title}}-{{userName}}-{{id}}',
		multiple: '{{title}}-{{userName}}-{{id}}-p{{#}}'
	}
	const KEYCODE_TO_SAVE = 83 // 83 is 's' key

	const gxf = xf.create(gmfetch)
	unsafeWindow.gmfetch=gmfetch
	unsafeWindow.gxf=gxf
	const $ = s => document.querySelector(s)
	const $$ = s => [...document.querySelectorAll(s)]
	const elementmerge = (a, b) => {
		Object.keys(b).forEach(k => {
			if (typeof b[k] === 'object') elementmerge(a[k], b[k])
			else if (k in a) a[k] = b[k]
			else a.setAttribute(k, b[k])
		})
	}
	const $el = (s, o) => {
		const el = document.createElement(s)
		elementmerge(el, o)
		return el
	}
	const debounce = delay => fn => {
		let de = false
		return (...args) => {
			if (de) return
			de = true
			fn(...args)
			setTimeout(() => (de = false), delay)
		}
	}
	const download = (url, fname) => {
		const a = $el('a', { href: url, download: fname || true })
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
	}
	const blobToImg = blob =>
		new Promise((res, rej) => {
			const src = URL.createObjectURL(blob)
			const img = $el('img', { src })
			img.onload = () => {
				URL.revokeObjectURL(src)
				res(img)
			}
			img.onerror = e => {
				URL.revokeObjectURL(src)
				rej(e)
			}
		})
	const getJSONBody = url =>
		xf
			.get(url)
			.json(r=>r.body)
	const getIllustData = id => getJSONBody(`/ajax/illust/${id}`)
	const getUgoiraMeta = id => getJSONBody(`/ajax/illust/${id}/ugoira_meta`)
	const getCrossOriginBlob = (url, Referer = 'https://www.pixiv.net/') =>
		gxf.get(url, { headers: { Referer } }).blob()
	const saveImage = ({ single, multiple }, id) =>
		getIllustData(id)
			.then(data => {
				const { illustType } = data
				switch (illustType) {
					case 0:
					case 1:
						{
							// normal
							const f = data.pageCount === 1 ? single : multiple
							const fname = f.replace(/{{(\w+?)}}/g, (m, g1) => data[g1])
							const url = data.urls.original
							const ext = url
								.split('/')
								.pop()
								.split('.')
								.pop()
							if (data.pageCount === 1) {
								return Promise.all([Promise.all([fname + '.' + ext, getCrossOriginBlob(url)])])
							} else {
								const rgxr = /{{#(\d+)}}/.exec(multiple)
								let offset = 0
								if (rgxr) {
									offset = parseInt(rgxr[1])
								}
								const len = (data.pageCount + offset) / 10 + 1
								const ar = []
								for (let i = offset; i < data.pageCount + offset; i++) {
									const num = i.toString().padStart(len, '0')
									ar.push(
										Promise.all([
											`${fname.replace(/{{#(\d+)?}}/g, num)}.${ext}`,
											getCrossOriginBlob(url.replace('p0', `p${i}`))
										])
									)
								}
								return Promise.all(ar)
							}
						}
						break
					case 2: {
						// ugoira
						const fname = single.replace(/{{(\w+?)}}/g, (m, g1) => data[g1])
						const numCpu = navigator.hardwareConcurrency || 4
						const gif = new GIF({ workers: numCpu * 4, quality: 10 })
						const ugoiraMeta = getUgoiraMeta(id)
						const ugoiraZip = ugoiraMeta.then(data => xf.get(data.src).blob())
						const gifFrames = ugoiraZip
							.then(z => {
								console.time('gif')
								return z
							})
							.then(JSZip.loadAsync)
							.then(({ files }) =>
								Promise.all(Object.values(files).map(f => f.async('blob').then(blobToImg)))
							)
						return Promise.all([ugoiraMeta, gifFrames])
							.then(
								([data, frames]) =>
									new Promise((res, rej) => {
										{
											for (let i = 0; i < frames.length; i++) {
												gif.addFrame(frames[i], { delay: data.frames[i].delay })
											}
											gif.on('finished', x => {
												console.timeEnd('gif')
												res(x)
											})
											gif.on('error', rej)
											gif.render()
										}
									})
							)
							.then(gifBlob => [[fname + '.gif', gifBlob]])
					}
				}
			})
			.then(results => {
				for (const [f, blob] of results) {
					const url = URL.createObjectURL(blob)
					download(url, f)
					URL.revokeObjectURL(url)
				}
			})

	if (location.pathname === '/member_illust.php') {
		const observer = new MutationObserver(
			debounce(10)(mut => {
				const menu = $('ul[role=menu]')
				if (!menu) return
				const n = menu.children.length
				const item = $el('li', {
					role: 'menuitem',
					onclick: () => saveImage(FORMAT, new URLSearchParams(location.search).get('illust_id'))
				})
				item.className = menu.children[n - 2].className
				const text = $el('span', { textContent: '⬇' })
				item.appendChild(text)
				menu.insertBefore(item, menu.children[n - 1])
			})
		)
		observer.observe(document.body, { childList: true, subtree: true })
	}

	// key shortcut
	{
		const SELECTOR_MAP = {
			'/': 'a.work:hover,a._work:hover',
			'/bookmark.php': 'a.work:hover',
			'/new_illust.php': 'a.work:hover',
			'/bookmark_new_illust.php': 'a.work:hover,.gtm-recommend-illust.gtm-thumbnail-link:hover',
			'/member_illust.php': 'figure>div[role=presentation]>div>a:hover',
			'/ranking.php': 'a.work:hover',
			'/search.php': '#js-react-search-mid a:hover,a.work:hover',
			'/member_illust.php': 'a.work:hover'
		}
		const selector = SELECTOR_MAP[location.pathname]
		addEventListener('keydown', e => {
			if (e.which !== KEYCODE_TO_SAVE) return // 's' key
			let id
			if (typeof selector === 'string') {
				const el = $(selector)
				if (!el) return
				id = /\d+/.exec(el.href.split('/').pop())[0]
			} else {
				id = selector()
			}
			if (id) saveImage(FORMAT, id)
		})
	}

	// support Patchouli
	{
		let times = 0
		const it = setInterval(() => {
			if (times >= 10) clearInterval(it)
			if (typeof Patchouli !== 'undefined' && Patchouli._isMounted) {
				$$('.image-flexbox').map(x => x.classList.add('work'))
				const observer = new MutationObserver(
					debounce(10)(mut => $$('.image-flexbox').map(x => x.classList.add('work')))
					// add class=work to let them works
				)
				observer.observe(Patchouli.$el, { childList: true, subtree: true })
				console.log('Pixiv easy save image: Patchouli detected!')
				clearInterval(it)
				GM_addStyle(`.image-item .work{margin-bottom:0px!important;}`) // disable default css
			}
			times++
		}, 1000)
	}
})()
