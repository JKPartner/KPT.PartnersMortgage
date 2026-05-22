const https = require('https');

function pipedriveGet(path, apiToken) {
  return new Promise((resolve, reject) => {
    const url = `/v1/${path}${path.includes('?') ? '&' : '?'}api_token=${apiToken}`;
    const options = {
      hostname: 'api.pipedrive.com',
      path: url,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const CUSTOM_FIELD_NAMES = [
  'Locked','Appraisal Ordered/Due','Disclosed','Sub. to Processing',
  'Sub. to UW','1st Loan Approval','COE','Loan Cont.','Appraisal Cont.'
];

const ALLOWED_PIPELINE_IDS = [2, 3];

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { secret, action, query } = JSON.parse(event.body);

    if (secret !== process.env.REALTOR_SECRET) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid access code' })
      };
    }

    const apiToken = process.env.PIPEDRIVE_API_KEY;

    if (action === 'search') {
      // Fetch deal fields, pipeline stages for both pipelines, in parallel
      const [fieldsResult, loanStagesResult, leadStagesResult, searchResult] = await Promise.all([
        pipedriveGet('dealFields?limit=200', apiToken),
        pipedriveGet('stages?pipeline_id=2', apiToken),
        pipedriveGet('stages?pipeline_id=3', apiToken),
        pipedriveGet(`persons/search?term=${encodeURIComponent(query)}&fields=name,email&limit=10`, apiToken)
      ]);

      // Build field name -> key map
      const fieldMap = {};
      if (fieldsResult.success && fieldsResult.data) {
        fieldsResult.data.forEach(f => { fieldMap[f.name] = f.key; });
      }

      // Build stage maps: stageId -> {name, order, pipelineId}
      // and pipelineId -> ordered array of stages
      const stageById = {};
      const pipelineStages = { 2: [], 3: [] };

      [loanStagesResult, leadStagesResult].forEach(result => {
        if (result.success && result.data) {
          result.data.forEach(s => {
            stageById[s.id] = { name: s.name, order: s.order_nr, pipelineId: s.pipeline_id };
          });
          const pid = result.data[0] && result.data[0].pipeline_id;
          if (pid) {
            pipelineStages[pid] = result.data.sort((a, b) => a.order_nr - b.order_nr);
          }
        }
      });

      function getNextStage(stageId, pipelineId) {
        const stages = pipelineStages[pipelineId] || [];
        const idx = stages.findIndex(s => s.id === stageId);
        if (idx === -1 || idx >= stages.length - 1) return null;
        return stages[idx + 1].name;
      }

      if (!searchResult.success || !searchResult.data || !searchResult.data.items.length) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ results: [] })
        };
      }

      const persons = searchResult.data.items.slice(0, 5);
      const results = [];

      for (const item of persons) {
        const person = item.item;

        const dealsResult = await pipedriveGet(
          `persons/${person.id}/deals?status=all_not_deleted&limit=50`, apiToken
        );

        const allDeals = dealsResult.success && dealsResult.data ? dealsResult.data : [];
        const filteredDeals = allDeals.filter(deal => ALLOWED_PIPELINE_IDS.includes(deal.pipeline_id));

        const dealsWithDetails = [];
        for (const deal of filteredDeals) {
          let latestNote = null;
          try {
            const notesResult = await pipedriveGet(
              `notes?deal_id=${deal.id}&limit=1&sort=add_time DESC`, apiToken
            );
            if (notesResult.success && notesResult.data && notesResult.data.length) {
              latestNote = notesResult.data[0].content.replace(/<[^>]*>/g, '').trim();
              if (latestNote.length > 150) latestNote = latestNote.substring(0, 150) + '...';
            }
          } catch(e) {}

          const customFields = {};
          CUSTOM_FIELD_NAMES.forEach(name => {
            const key = fieldMap[name];
            const val = key ? deal[key] : null;
            customFields[name] = (val !== undefined && val !== null && val !== '') ? val : 'TBD';
          });

          const currentStageName = stageById[deal.stage_id] ? stageById[deal.stage_id].name : (deal.stage_name || null);
          const nextStageName = getNextStage(deal.stage_id, deal.pipeline_id);

          dealsWithDetails.push({
            id: deal.id,
            title: deal.title,
            stage: currentStageName,
            next_stage: nextStageName,
            status: deal.status,
            value: deal.value,
            currency: deal.currency,
            close_date: deal.expected_close_date,
            add_time: deal.add_time,
            update_time: deal.update_time,
            won_time: deal.won_time,
            lost_time: deal.lost_time,
            latest_note: latestNote,
            pipeline: deal.pipeline_name,
            pipeline_id: deal.pipeline_id,
            custom_fields: customFields
          });
        }

        if (dealsWithDetails.length > 0) {
          results.push({
            id: person.id,
            name: person.name,
            email: person.emails ? person.emails[0] : null,
            phone: person.phones ? person.phones[0] : null,
            deals: dealsWithDetails
          });
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results })
      };
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown action' })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
