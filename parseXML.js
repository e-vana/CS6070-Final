//xml parser
const fs = require('fs');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();


//postgres setup
const { Pool, Client } = require('pg')


async function readAndWriteXmlToJSON(){
  try {
    let data = await fs.promises.readFile(__dirname + '/data/full_data_set.xml');

    let parsedData = await parser.parseStringPromise(data);
    console.log(parsedData);
    let convertedToJSArray = [];
    parsedData.PubmedArticleSet.PubmedArticle.forEach(article => {
      let payload = {};

      //obtain pmid
      let pmid = article.MedlineCitation[0].PMID[0]["_"];

      //obtain article title
      let articleTitle = article.MedlineCitation[0].Article[0].ArticleTitle;

      //obtain authors
      let authorsWithNamesArray = [];
      if(article.MedlineCitation[0].Article[0].AuthorList){
        let authorArray = article.MedlineCitation[0].Article[0].AuthorList[0].Author;
        authorArray.forEach(author => {
          let authorObj = {};
          if(author.ForeName){
            authorObj.first_name = author.ForeName[0]
          }
          if(author.LastName){
            authorObj.last_name = author.LastName[0]
          }
          authorsWithNamesArray.push(authorObj);
        });
      }


      //obtain mesh headings
      let mesh = article.MedlineCitation[0].MeshHeadingList;
      let meshHeadingDescriptors = [];
      mesh.forEach(mesh => {
        let meshHeadings = [];
        meshHeadings = mesh.MeshHeading;
        meshHeadings.forEach(mh => {
          let mhDesc = (mh.DescriptorName[0]["_"]);
          meshHeadingDescriptors.push(mhDesc);
        });
      });

      //obtain keywords
      let kwListArray = [];
      if(article.MedlineCitation[0].KeywordList){
        let kwList = article.MedlineCitation[0].KeywordList[0].Keyword;
        kwList.forEach(kw => {
          kwListArray.push(kw["_"])
        });
      }

      //obtain Jouranl Title
      let journal = article.MedlineCitation[0];
      let journalTitle = article.MedlineCitation[0].Article[0].Journal[0].Title[0];
      // console.log(article.MedlineCitation[0].Article[0].Journal[0].Title[0]);

      //obtain Jouranl ISSN
      let journalISSN = null;
      if(journal.Article[0].Journal[0].ISSN){
        journalISSN = journal.Article[0].Journal[0].ISSN[0]["_"];
      }

      //obtain publish date
      //date string yyyy-mm-dd
      let publishDate = article.MedlineCitation[0].DateCompleted[0];
      let year = publishDate.Year[0];
      let month = publishDate.Month[0];
      let day = publishDate.Day[0];
      let dateStr = `${year}-${month}-${day}`;


      //obtain abstract text
      if(journal.Article[0].Abstract){
        let abstractText = journal.Article[0].Abstract[0].AbstractText;
        payload.abstractText = abstractText;
      }

      payload.pmid = parseInt(pmid);
      payload.articleTitle = articleTitle;
      payload.authors = authorsWithNamesArray;
      payload.mesh = meshHeadingDescriptors;
      payload.keywords = kwListArray;
      payload.journalTitle = journalTitle;
      payload.journalISSN = journalISSN;
      payload.dateComplete = dateStr;

      if(payload.journalISSN != null){
        convertedToJSArray.push(payload);
      }
    });
    let stringJSON = JSON.stringify(convertedToJSArray, null, 2);
    let saveJSON = await fs.promises.writeFile(__dirname + '/data/test-full.json', stringJSON);


    //check to see if journal ISSN has a match, if no insert journal information, if yes return ID
    //create citation INSERT INTO citation (date_completed, article_title, abstract_text, issn) VALUES (payload...)
    //save PMID
    //foreach author, check to see if author exists, yes return id, add to cit_author bridge table, no create author
    //foreach mesh check to see if meshkeyword exists, if yes return id, add to cit_mesh bridge table, no create mesh
    //foreach keyword, check to see if keyword exists, if yes return id, add to cit_keyword bridge table, no create keyword and add to table

  } catch (error) {
    console.log(error);
  }
}

async function readAndWriteJSONToDb(){
  try {
    const client = new Client({
      user: 'evana',
      host: '10.80.28.228',
      database: 'evana',
      password: '000665067',
      port: 5432,
    })
    console.log("Connecting to database...");
    client.connect();

    let stringJSON = await fs.promises.readFile(__dirname + '/data/test-full.json');
    let objJSON = await JSON.parse(stringJSON);

    for (const cit of objJSON) {
      console.log(cit);
      let journalQuery = 'SELECT * FROM journal WHERE issn=$1';
      let journalParameter = [cit.journalISSN];
      let journalExists = await client.query(journalQuery, journalParameter);
      if(journalExists.rows.length == 0){
        //create journal entry in table
        let newJournalQuery = 'INSERT INTO journal (issn, journal_title) VALUES ($1, $2)';
        let newJournalValues = [cit.journalISSN, cit.journalTitle];
        let createNewJournal = await client.query(newJournalQuery, newJournalValues);
      }

      //create citation
      let createNewCitationQuery = 'INSERT INTO citation (pmid, date_completed, article_title, abstract_text, issn) VALUES ($1, $2, $3, $4, $5) RETURNING *';
      let abstractText = null;
      if("abstractText" in cit){abstractText = cit.abstractText[0]}
      let createNewCitationParameters = [cit.pmid, cit.dateComplete, cit.articleTitle[0], abstractText, cit.journalISSN];
      let createNewCitation = await client.query(createNewCitationQuery, createNewCitationParameters);

      //creat meshes
      for (const mesh of cit.mesh) {
        //see if the mesh exists 
        let meshExistsQuery = 'SELECT * FROM mesh WHERE term=$1';
        let meshParameter = [mesh];
        let meshExists = await client.query(meshExistsQuery, meshParameter);

        let meshIdentifier = null;
        if(meshExists.rows.length == 0){
          let createMeshQuery = 'INSERT INTO mesh (term) VALUES ($1) RETURNING *';
          let createMeshParameters = [mesh];
          let createMesh = await client.query(createMeshQuery, createMeshParameters);
          meshIdentifier = createMesh.rows[0].meshid;
        }
        if(meshExists.rows.length > 0){
          meshIdentifier = meshExists.rows[0].meshid;
        }
        let meshCitQuery = 'INSERT INTO cit_mesh (cit_pmid, mesh_id) VALUES ($1, $2) RETURNING *';
        let meshCitParameters = [cit.pmid, meshIdentifier];
        let meshCitInsert = await client.query(meshCitQuery, meshCitParameters);
      }
      //create authors
      for (const author of cit.authors) {
        //see if the author exists 
        let authorExistsQuery = 'SELECT * FROM author WHERE first_name=$1 AND last_name=$2';
        let authorExistsParameter = [author.first_name, author.last_name];
        let authorExists = await client.query(authorExistsQuery, authorExistsParameter);

        let authorIdentifier = null;
        if(authorExists.rows.length == 0){
          let createAuthorQuery = 'INSERT INTO author (first_name, last_name) VALUES ($1, $2) RETURNING *';
          let createAuthorParameters = [author.first_name, author.last_name];
          let createAuthor = await client.query(createAuthorQuery, createAuthorParameters);
          authorIdentifier = createAuthor.rows[0].authorid;
        }
        if(authorExists.rows.length > 0){
          authorIdentifier = authorExists.rows[0].authorid;
        }
        let authorCityQuery = 'INSERT INTO cit_author (cit_pmid, author_id) VALUES ($1, $2) RETURNING *';
        let authorCitParameters = [cit.pmid, authorIdentifier];
        let authorCitInsert = await client.query(authorCityQuery, authorCitParameters);
      }
      //create keywords
      if(cit.keywords.length > 0){
        for (const keyword of cit.keywords) {
          //see if the author exists 
          let keywordExistsQuery = 'SELECT * FROM keyword WHERE term=$1';
          let keywordExistsParameters = [keyword];
          let keywordExists = await client.query(keywordExistsQuery, keywordExistsParameters);
  
          let keywordIdentifer = null;
          if(keywordExists.rows.length == 0){
            let createKeywordQuery = 'INSERT INTO keyword (term) VALUES ($1) RETURNING *';
            let createKeywordParamater = [keyword];
            let createKeyword = await client.query(createKeywordQuery, createKeywordParamater);
            keywordIdentifer = createKeyword.rows[0].kwid;
          }
          if(keywordExists.rows.length > 0){
            keywordIdentifer = createKeyword.rows[0].kwid;
          }
          let keywordCitQuery = 'INSERT INTO cit_keyword (cit_pmid, keyword_id) VALUES ($1, $2) RETURNING *';
          let keywordCitParameters = [cit.pmid, keywordIdentifer];
          let keywordCit = await client.query(keywordCitQuery, keywordCitParameters);
        }
      }

    }
    //check to see if journal ISSN has a match, if no insert journal information, if yes return ID
    //create citation INSERT INTO citation (date_completed, article_title, abstract_text, issn) VALUES (payload...)
    //save PMID
    //foreach author, check to see if author exists, yes return id, add to cit_author bridge table, no create author
    //foreach mesh check to see if meshkeyword exists, if yes return id, add to cit_mesh bridge table, no create mesh
    //foreach keyword, check to see if keyword exists, if yes return id, add to cit_keyword bridge table, no create keyword and add to table
    
    client.end();
  } catch (error) {
    console.log(error);
  }
}



async function parseXML(){
  try {
    console.log("Writing XML to JSON...");
    // await readAndWriteXmlToJSON();
    console.log("Reading JSON for DB Insertion...");
    await readAndWriteJSONToDb();
  } catch (error) {
    console.log(error);
  }
}

parseXML();