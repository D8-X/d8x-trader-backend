create or replace view trades_view as 
select pli.perpetual_id||'-'||pli.perpetual_name as perpetual_long_id,
	th.*
from trades_history th 
join perpetual_long_id pli 
on pli.perpetual_id = th.perpetual_id 
and th.trade_timestamp >= pli.valid_from 
and th.trade_timestamp < pli.valid_to
