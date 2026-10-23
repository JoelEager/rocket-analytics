"""Curate the launch, entity, and link fields shown on the site."""


def pick(value, key):
    """Return value[key] if value is a dict, else the value itself."""
    return value.get(key) if isinstance(value, dict) else value


def pull(source, spec):
    """Copy fields from a dict. Spec items are 'key' for same-named copies
    or (dest, 'key' | 'key.subkey') to rename/unwrap — e.g. the spec
    ['name', ('orbit', 'orbit.abbrev')] maps source['name'] to out['name']
    and source['orbit']['abbrev'] to out['orbit']."""
    out = {}
    for item in spec:
        if isinstance(item, str):
            out[item] = source.get(item)
        else:
            dest, path = item
            key, _, sub = path.partition(".")
            out[dest] = pick(source.get(key), sub) if sub else source.get(key)
    return out


# Launch-record stats shared by agency and rocket detail payloads.
RECORD_FIELDS = [
    ("launches", "total_launch_count"),
    ("successful", "successful_launches"),
    ("failed", "failed_launches"),
    ("pending", "pending_launches"),
    ("streak", "consecutive_successful_launches"),
    ("landings_attempted", "attempted_landings"),
    ("landings_successful", "successful_landings"),
    ("landings_failed", "failed_landings"),
    ("landing_streak", "consecutive_successful_landings"),
]

AGENCY_FIELDS = [
    "name", "abbrev", ("type", "type.name"), ("country", "country_code"),
    "description", "administrator", ("founded", "founding_year"),
    "launchers", "spacecraft", "info_url", "wiki_url",
    *RECORD_FIELDS,
]

ROCKET_FIELDS = [
    "family", "variant", "active", "reusable", "description",
    "length", "diameter", "launch_mass", "leo_capacity", "gto_capacity",
    ("thrust", "to_thrust"), "maiden_flight", "launch_cost", "alias",
    "min_stage", "max_stage", "apogee", "vehicle_range",
    ("image", "image_url"), "info_url", "wiki_url",
    *RECORD_FIELDS,
]

PAD_FIELDS = [
    "name", "description", "latitude", "longitude", "map_url", "info_url",
    "wiki_url", ("launches", "total_launch_count"),
]

LAUNCH_FIELDS = [
    "name", "net", ("status", "status.name"), "window_start", "window_end",
    "probability", ("image", "image.image_url"),
    ("infographic", "infographic.image_url"), "webcast_live",
    "failreason", "holdreason", "weather_concerns",
    ("attempts_location", "location_launch_attempt_count"),
    ("attempts_location_year", "location_launch_attempt_count_year"),
    "pad_turnaround",
]

UPDATE_FIELDS = ["comment", "info_url", "created_on", "created_by",
                 "profile_image"]


def agency_detail(agency):
    """Curated fields for a provider or mission agency."""
    detail = pull(agency, AGENCY_FIELDS)
    detail["image"] = pick(agency.get("image_url") or agency.get("image"),
                           "image_url")
    return detail


def rocket_detail(config):
    """Curated fields for a rocket configuration."""
    manufacturer = config.get("manufacturer") or {}
    return {
        "name": config.get("full_name") or config.get("name"),
        "manufacturer": manufacturer.get("name"),
        "manufacturer_abbrev": manufacturer.get("abbrev"),
        "manufacturer_id": manufacturer.get("id"),
        **pull(config, ROCKET_FIELDS),
    }


def pad_detail(pad):
    """Curated fields for a launch pad."""
    detail = pull(pad, PAD_FIELDS)
    detail["location"] = pick(pad.get("location"), "name")
    return detail


def link_details(*url_lists):
    """Normalize info/vid URL entries, which may be dicts or bare strings."""
    links = []
    for entries in url_lists:
        for entry in entries or []:
            url = pick(entry, "url")
            if not url:
                continue
            link = {"url": url}
            if isinstance(entry, dict):
                link["label"] = pick(entry.get("type"), "name")
            links.append(link)
    return links


def launch_detail(launch):
    """Pick the fields worth showing in the details modal."""
    mission = launch.get("mission") or {}
    return {
        **pull(launch, LAUNCH_FIELDS),
        "mission_name": mission.get("name"),
        "mission_type": mission.get("type"),
        "orbit": pick(mission.get("orbit"), "abbrev"),
        "mission_description": mission.get("description"),
        "mission_patches": [
            url for p in launch.get("mission_patches") or []
            if (url := pick(p, "image_url"))
        ],
        "program": [pick(p, "name") for p in launch.get("program") or []],
        # IDs into the entities dict, so the frontend can look up the
        # provider/rocket/pad/agency details instead of embedding copies.
        "provider_id": pick(launch.get("launch_service_provider"), "id"),
        "rocket_id": pick(pick(launch.get("rocket"), "configuration"), "id"),
        "pad_id": pick(launch.get("pad"), "id"),
        "agency_ids": [a.get("id") for a in mission.get("agencies") or []
                       if a.get("id") is not None],
        "updates": [pull(u, UPDATE_FIELDS)
                    for u in launch.get("updates") or []],
        "links": link_details(launch.get("infoURLs"), launch.get("vidURLs")),
        "mission_links": link_details(mission.get("info_urls"),
                                      mission.get("vid_urls")),
    }


def collect_entities(launches):
    """Deduplicate entity objects observed across launches, keyed by id."""
    entities = {"providers": {}, "rockets": {}, "agencies": {}, "pads": {}}

    def add(group, obj, detail_fn):
        if obj and obj.get("id") is not None:
            entities[group].setdefault(obj["id"], detail_fn(obj))

    for launch in launches:
        add("providers", launch.get("launch_service_provider"), agency_detail)
        add("rockets", pick(launch.get("rocket"), "configuration"),
            rocket_detail)
        for agency in pick(launch.get("mission"), "agencies") or []:
            add("agencies", agency, agency_detail)
        add("pads", launch.get("pad"), pad_detail)
    return entities
