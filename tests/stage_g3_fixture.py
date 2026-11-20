import json


def deepseek(path, body=None, **kwargs):
    if path == "/models":
        return {"data":[{"id":"deepseek-flash"}]}
    assert path == "/chat/completions"
    payload=json.loads(body["messages"][1]["content"])
    if "themePalette" in payload:
        revision=payload.get("revision")
        color="--v-green" if revision else "--v-primary"
        name="药盒动画修订版" if revision else "药盒滑动"
        svg=(f'<svg viewBox="0 0 800 450"><ellipse cx="400" cy="280" rx="210" ry="115" fill="var(--v-primary-soft)"/>'
             f'<g data-part="box"><rect x="310" y="215" width="184" height="125" rx="16" fill="var({color})" '
             'stroke="var(--v-ink)" stroke-width="6"/><rect x="328" y="240" width="130" height="21" rx="6" '
             'fill="var(--v-card-bg)"/></g></svg>')
        data={"name":name,"useFor":"用药盒移动表达核对包装","spec":{"schemaVersion":1,"svg":svg,"duration":3,
              "tracks":[{"part":"box","prop":"translateX","from":-120,"to":112,"start":0,"end":.84,"ease":"inOutCubic"}],
              "events":[{"type":"check","t":.84}]}}
    elif "targetIndices" in payload:
        data={"shots":[{"index":i,"kind":"scene" if i < 2 else "card",
             "reason":f'「{payload["shots"][i]["name"]}」需要分步呈现用药包装与记录。',
             "fallback":"card","params":{},**({"mgRequest":"让药盒从左滑入并停在核对位置"} if i == 0 else {})}
             for i in payload["targetIndices"]]}
    else:
        captions = ["拿起药盒，看看外包装上的信息。","找到说明书后，核对栏目和要点。","记下还没有弄清楚的问题。"]
        data={"title":"核对用药资料","shortTitle":"用药资料","chapters":["先看","再记"],"shots":[
              {"name":name,"chapterIndex":min(i,1),"line":line,"cues":[{"text":line,"focus":"0"}],
               "points":{"type":ptype,"headline":name,"items":[{"title":name,"detail":"用药资料核对","tag":""}]}}
              for i,(name,line,ptype) in enumerate(zip(("看药盒","看说明书","记问题"),captions,("cover","steps","summary")))]}
    return {"model":"deepseek-flash","usage":{"prompt_tokens":500,"completion_tokens":180},
            "choices":[{"finish_reason":"stop","message":{"content":json.dumps(data,ensure_ascii=False)}}]}
