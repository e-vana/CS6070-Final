//express setup
const express = require('express');
const app = express();
const port = 3003;

//postgres setup
const { Client } = require('pg');
const client = new Client();

//Use EJS as the view engine
app.set('view engine', 'ejs');
app.use(express.static("public"))

const { Pool } = require('pg')
const pool = new Pool({
  user: 'evana',
  host: '10.80.28.228',
  database: 'evana',
  password: '000665067',
  port: 5432,
})
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

//Express web app endpoints
app.get('/', (req, res) => {
  res.render('home');
})
app.get('/results', async (req, res) => {
  console.log(req.query);
  let queryParams = req.query;
  let queryTerm = queryParams.query;

  if(req.query.dateStart && req.query.dateEnd){
    let values = [`%${queryTerm}%`, `%${req.query.dateStart}%`, `%${req.query.dateEnd}%`];
    let query = `SELECT article_title, date_completed FROM citation WHERE article_title ILIKE $1 AND date_completed > $2 AND date_completed < $3`;
    let doQuery = await pool.query(query, values);
    let searchResults = doQuery.rows;
    return res.render('results', {queryTerm, searchResults});
  }

  let values = [`%${queryTerm}%`];    
  let query = `SELECT article_title FROM citation WHERE article_title ILIKE $1`;
  let doQuery = await pool.query(query, values);
  let searchResults = doQuery.rows;
  console.log(searchResults);
  return res.render('results', {queryTerm, searchResults});


});









  // let query = await pool.query(`SELECT article_title FROM citation WHERE article_title ILIKE '%${queryTerm}%'`);
