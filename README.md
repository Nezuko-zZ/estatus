const pool = new Pool({
  user: 'postgres',       // 你的数据库用户名 (默认 postgres)
  host: 'dwh.yiandrive.com',      // 数据库地址
  database: 'estatus',    // 数据库名 (需提前创建)
  password: 'mysecretpassword',   // 你的数据库密码
  port: 17948,             // 默认端口
});