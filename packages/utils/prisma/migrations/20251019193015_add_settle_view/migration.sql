create or replace view settle_view as 
select pli.perpetual_id||'-'||pli.perpetual_name as perpetual_long_id,
	sh.*
from settle_history sh 
join perpetual_long_id pli 
on pli.perpetual_id = sh.perpetual_id 
and sh.timestamp >= pli.valid_from 
and sh.timestamp < pli.valid_to