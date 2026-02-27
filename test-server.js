const http = require("http");

const PORT = 3000;
let requestLog = [];

const pages = {
  "/": `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Test Anasayfa</title></head>
<body>
  <h1>Test Sitesi - Anasayfa</h1>
  <p>Bu bir test sayfasidir.</p>
  <nav>
    <a href="/hakkimizda">Hakkimizda</a> |
    <a href="/hizmetler">Hizmetler</a> |
    <a href="/iletisim">Iletisim</a> |
    <a href="/blog">Blog</a>
  </nav>
  <div style="height:1500px;background:linear-gradient(#eee,#fff)">
    <p>Scroll alani...</p>
  </div>
</body>
</html>`,

  "/hakkimizda": `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Hakkimizda</title></head>
<body>
  <h1>Hakkimizda</h1>
  <p>Biz bir test sirketiyiz.</p>
  <a href="/">Anasayfa</a> | <a href="/hizmetler">Hizmetler</a> | <a href="/blog">Blog</a>
  <div style="height:1200px;background:linear-gradient(#f0f0ff,#fff)">
    <p>Icerik alani...</p>
  </div>
</body>
</html>`,

  "/hizmetler": `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Hizmetler</title></head>
<body>
  <h1>Hizmetlerimiz</h1>
  <ul>
    <li><a href="/hizmetler/web">Web Gelistirme</a></li>
    <li><a href="/hizmetler/mobil">Mobil Uygulama</a></li>
    <li><a href="/hizmetler/seo">SEO</a></li>
  </ul>
  <a href="/">Anasayfa</a> | <a href="/iletisim">Iletisim</a>
  <div style="height:1000px;background:linear-gradient(#f0fff0,#fff)">
    <p>Detaylar...</p>
  </div>
</body>
</html>`,

  "/hizmetler/web": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Web Gelistirme</title></head>
<body><h1>Web Gelistirme</h1><p>Modern web cozumleri.</p>
<a href="/hizmetler">Hizmetler</a> | <a href="/">Anasayfa</a>
<div style="height:800px"><p>Detay...</p></div></body></html>`,

  "/hizmetler/mobil": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Mobil Uygulama</title></head>
<body><h1>Mobil Uygulama</h1><p>iOS ve Android gelistirme.</p>
<a href="/hizmetler">Hizmetler</a> | <a href="/">Anasayfa</a>
<div style="height:800px"><p>Detay...</p></div></body></html>`,

  "/hizmetler/seo": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>SEO</title></head>
<body><h1>SEO Hizmetleri</h1><p>Arama motoru optimizasyonu.</p>
<a href="/hizmetler">Hizmetler</a> | <a href="/blog">Blog</a>
<div style="height:800px"><p>Detay...</p></div></body></html>`,

  "/iletisim": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Iletisim</title></head>
<body><h1>Iletisim</h1><p>Bize ulasin.</p>
<a href="/">Anasayfa</a> | <a href="/hakkimizda">Hakkimizda</a>
<div style="height:900px"><p>Form alani...</p></div></body></html>`,

  "/blog": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Blog</title></head>
<body><h1>Blog</h1>
<ul>
  <li><a href="/blog/yazi-1">Ilk Yazi</a></li>
  <li><a href="/blog/yazi-2">Ikinci Yazi</a></li>
</ul>
<a href="/">Anasayfa</a>
<div style="height:1000px"><p>Yazilar...</p></div></body></html>`,

  "/blog/yazi-1": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Ilk Yazi</title></head>
<body><h1>Blog Yazisi 1</h1><p>Test blog icerigi.</p>
<a href="/blog">Blog</a> | <a href="/blog/yazi-2">Sonraki Yazi</a>
<div style="height:1200px"><p>Uzun icerik...</p></div></body></html>`,

  "/blog/yazi-2": `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Ikinci Yazi</title></head>
<body><h1>Blog Yazisi 2</h1><p>Baska bir test yazisi.</p>
<a href="/blog">Blog</a> | <a href="/blog/yazi-1">Onceki Yazi</a>
<div style="height:1200px"><p>Uzun icerik...</p></div></body></html>`,
};

const server = http.createServer((req, res) => {
  const entry = {
    time: new Date().toLocaleTimeString("tr-TR"),
    method: req.method,
    url: req.url,
    ip: req.socket.remoteAddress,
    userAgent: req.headers["user-agent"] || "-",
    referrer: req.headers["referer"] || "-",
  };
  requestLog.push(entry);

  const num = requestLog.length;
  console.log(
    `[${entry.time}] #${num} ${entry.method} ${entry.url} | UA: ${entry.userAgent.substring(0, 50)}... | Ref: ${entry.referrer}`
  );

  const html = pages[req.url];
  if (html) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } else {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>404 - Sayfa Bulunamadi</h1><a href='/'>Anasayfa</a>");
  }
});

server.listen(PORT, () => {
  console.log("===========================================");
  console.log("       TEST SUNUCUSU AKTIF");
  console.log(`       http://localhost:${PORT}`);
  console.log("===========================================");
  console.log("Gelen istekler asagida gorunecek:\n");
});
