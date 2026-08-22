update core.competitions
set competition_type = 'friendly'
where competition_type = 'league'
  and lower(name) like '%friendl%';
