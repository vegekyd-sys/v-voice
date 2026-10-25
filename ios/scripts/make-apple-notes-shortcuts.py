#!/usr/bin/env python3
"""Build unsigned, inspectable Notes workflows; sign with Apple's shortcuts CLI.

No note content, device token or identity is embedded in these templates.
"""
import argparse
import pathlib
import plistlib
import uuid


def identifier(label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "vvoice:notes-shortcut:v1:" + label)).upper()


def reference(label):
    return {"Type": "ActionOutput", "OutputUUID": identifier(label), "OutputName": label}


def attachment(value):
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def text(label):
    return {"Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": reference(label)}},
            "WFSerializationType": "WFTextTokenString"}


def action(name, label, **parameters):
    return {"WFWorkflowActionIdentifier": name,
            "WFWorkflowActionParameters": {"UUID": identifier(label), **parameters}}


def workflow(operation, team_id):
    actions = [action("is.workflow.actions.detect.dictionary", "请求", WFInput=attachment({"Type": "ExtensionInput"}))]
    for key in ["requestID", "token", "text"]:
        actions.append(action("is.workflow.actions.getvalueforkey", key,
                              WFInput=attachment(reference("请求")), WFDictionaryKey=key,
                              WFGetDictionaryValueType="Value"))
    if operation == "create":
        # System-exported Notes action. OpenWhenRun defaults to true otherwise.
        actions.append(action("com.apple.mobilenotes.SharingExtension", "实际备忘录",
                              WFCreateNoteInput=text("text"), OpenWhenRun=False))
        questions = []
    else:
        # The importer asks for one fixed local Note, never a model-supplied ID.
        actions.append(action("is.workflow.actions.appendnote", "实际备忘录", WFInput=text("text")))
        questions = [{"Category": "Parameter", "ActionIndex": 4, "ParameterKey": "WFNote",
                      "Text": "选择 V 今后追加的固定备忘录（只需配置一次）"}]
    actions.append(action("is.workflow.actions.detect.text", "保存后读回",
                          WFInput=attachment(reference("实际备忘录"))))
    actions.append(action("com.versa.vvoice.VerifyAppleNoteIntent", "核对回执",
                          AppIntentDescriptor={"BundleIdentifier": "com.versa.vvoice",
                                               "AppIntentIdentifier": "VerifyAppleNoteIntent", "Name": "V Voice",
                                               "TeamIdentifier": team_id},
                          requestID=text("requestID"), token=text("token"), savedText=text("保存后读回")))
    actions.append(action("is.workflow.actions.output", "返回", WFOutput=text("核对回执")))
    return {"WFWorkflowName": "V 新建备忘录" if operation == "create" else "V 追加备忘录",
            "WFWorkflowActions": actions, "WFWorkflowClientVersion": "2600.0",
            "WFWorkflowMinimumClientVersion": 900, "WFWorkflowMinimumClientVersionString": "900",
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4274264319, "WFWorkflowIconGlyphNumber": 61465},
            "WFWorkflowHasShortcutInputVariables": True,
            "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
            "WFWorkflowOutputContentItemClasses": ["WFStringContentItem"],
            "WFWorkflowHasOutputFallback": True, "WFWorkflowImportQuestions": questions,
            "WFWorkflowTypes": [], "WFQuickActionSurfaces": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--team-id", required=True, help="TeamIdentifier of the installed V Voice signed app")
    args = parser.parse_args()
    if len(args.team_id) != 10 or not args.team_id.isalnum():
        parser.error("--team-id must be the ten-character signing TeamIdentifier")
    args.output.mkdir(parents=True, exist_ok=True)
    for operation in ["create", "append"]:
        path = args.output / ("V 新建备忘录" if operation == "create" else "V 追加备忘录")
        path = path.with_suffix(".unsigned.shortcut")
        path.write_bytes(plistlib.dumps(workflow(operation, args.team_id), fmt=plistlib.FMT_XML, sort_keys=False))
        print(path)


if __name__ == "__main__":
    main()
